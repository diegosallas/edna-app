package main

// Aviso no celular quando chega pedido — mesmo com o app fechado.
//
// É Web Push: o navegador de quem quer ser avisado registra uma "inscrição"
// (endereço + chaves) e o servidor manda a notificação por ela, assinada com
// o par de chaves VAPID deste servidor. O conteúdo vai cifrado para o
// navegador; o serviço de push da Google/Apple/Mozilla só vê que existe uma
// mensagem. Sem inscrição, nada muda: o app continua buscando a cada 30 s.
//
// O par VAPID nasce na primeira subida e fica em <dados>/vapid.json. Perder
// esse arquivo invalida todas as inscrições — está no backup por isso.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const maxInscricoes = 5 // aparelhos por pessoa

type inscricao struct {
	Endpoint string    `json:"endpoint"`
	P256dh   string    `json:"p256dh"`
	Auth     string    `json:"auth"`
	Desde    time.Time `json:"desde"`
}

type vapid struct {
	Publica string `json:"publica"`
	Privada string `json:"privada"`
}

func carregarVAPID(pasta string) (vapid, error) {
	caminho := filepath.Join(pasta, "vapid.json")
	var v vapid
	if b, err := os.ReadFile(caminho); err == nil {
		if json.Unmarshal(b, &v) == nil && v.Publica != "" && v.Privada != "" {
			return v, nil
		}
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return v, err
	}
	v = vapid{Publica: pub, Privada: priv}
	b, _ := json.MarshalIndent(v, "", " ")
	if err := os.WriteFile(caminho, b, 0o600); err != nil {
		return v, err
	}
	log.Printf("par VAPID novo gravado em %s", caminho)
	return v, nil
}

// lerInscricao aceita o JSON que PushSubscription.toJSON() devolve.
func lerInscricao(w http.ResponseWriter, r *http.Request) (inscricao, bool) {
	var corpo struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !lerJSON(w, r, &corpo) {
		return inscricao{}, false
	}
	if len(corpo.Endpoint) < 20 || len(corpo.Endpoint) > 1000 || corpo.Keys.P256dh == "" || corpo.Keys.Auth == "" ||
		(corpo.Endpoint[:8] != "https://") {
		erro(w, http.StatusBadRequest, "inscrição inválida")
		return inscricao{}, false
	}
	return inscricao{Endpoint: corpo.Endpoint, P256dh: corpo.Keys.P256dh, Auth: corpo.Keys.Auth, Desde: time.Now()}, true
}

// guardarInscricao acrescenta sem duplicar (mesmo endpoint = mesmo aparelho).
func guardarInscricao(lista []inscricao, nova inscricao) []inscricao {
	for i, s := range lista {
		if s.Endpoint == nova.Endpoint {
			lista[i] = nova
			return lista
		}
	}
	if len(lista) >= maxInscricoes {
		lista = lista[1:] // o mais antigo sai
	}
	return append(lista, nova)
}

func semInscricao(lista []inscricao, endpoint string) []inscricao {
	saida := lista[:0]
	for _, s := range lista {
		if s.Endpoint != endpoint {
			saida = append(saida, s)
		}
	}
	return saida
}

// --- rotas -----------------------------------------------------------------------

func (s *servidor) chavePush(w http.ResponseWriter, r *http.Request) {
	escrever(w, http.StatusOK, map[string]string{"chave": s.vapid.Publica})
}

// pushDono: POST guarda a inscrição do dono; DELETE tira.
func (s *servidor) pushDono(w http.ResponseWriter, r *http.Request, id string) {
	ins, ok := lerInscricao(w, r)
	if !ok {
		return
	}
	_, err := s.arm.alterar(id, func(c *conta) error {
		if r.Method == http.MethodDelete {
			c.Push = semInscricao(c.Push, ins.Endpoint)
		} else {
			c.Push = guardarInscricao(c.Push, ins)
		}
		return nil
	})
	if err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushParceiro: o parceiro quer saber quando o pedido for concluído.
func (s *servidor) pushParceiro(w http.ResponseWriter, r *http.Request, id string, quem parceiro) {
	ins, ok := lerInscricao(w, r)
	if !ok {
		return
	}
	_, err := s.arm.alterar(id, func(c *conta) error {
		for i := range c.Parceiros {
			if c.Parceiros[i].ID != quem.ID {
				continue
			}
			if r.Method == http.MethodDelete {
				c.Parceiros[i].Push = semInscricao(c.Parceiros[i].Push, ins.Endpoint)
			} else {
				c.Parceiros[i].Push = guardarInscricao(c.Parceiros[i].Push, ins)
			}
		}
		return nil
	})
	if err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- enviar ------------------------------------------------------------------------

type aviso struct {
	Titulo string `json:"titulo"`
	Corpo  string `json:"corpo"`
	Tag    string `json:"tag"`
	URL    string `json:"url"`
}

// enviarPush manda o aviso para cada aparelho e devolve os endpoints que
// morreram (404/410), para quem chamou tirar da lista. Roda em goroutine:
// o pedido não espera a Google responder.
func (s *servidor) enviarPush(lista []inscricao, av aviso, urgente bool) []string {
	if s.vapid.Privada == "" || len(lista) == 0 {
		return nil
	}
	corpo, _ := json.Marshal(av)
	urgencia := webpush.UrgencyNormal
	if urgente {
		urgencia = webpush.UrgencyHigh
	}
	var mortos []string
	for _, ins := range lista {
		resp, err := webpush.SendNotification(corpo, &webpush.Subscription{
			Endpoint: ins.Endpoint,
			Keys:     webpush.Keys{P256dh: ins.P256dh, Auth: ins.Auth},
		}, &webpush.Options{
			Subscriber:      "mailto:contato@fazmeuapp.com.br",
			VAPIDPublicKey:  s.vapid.Publica,
			VAPIDPrivateKey: s.vapid.Privada,
			TTL:             6 * 3600,
			Urgency:         urgencia,
		})
		if err != nil {
			log.Printf("push: %v", err)
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
			mortos = append(mortos, ins.Endpoint)
		} else if resp.StatusCode >= 300 {
			log.Printf("push: %s", resp.Status)
		}
	}
	return mortos
}

// avisarDono roda depois de um pedido novo.
func (s *servidor) avisarDono(id string, lista []inscricao, p pedido) {
	titulo := "Pedido novo"
	if p.Urgente {
		titulo = "Pedido urgente"
	}
	if p.De != "" {
		titulo += " de " + p.De
	}
	mortos := s.enviarPush(lista, aviso{Titulo: titulo, Corpo: p.Texto, Tag: fmt.Sprintf("amor-%d", p.ID), URL: "../app/"}, p.Urgente)
	if len(mortos) > 0 {
		s.arm.alterar(id, func(c *conta) error {
			for _, e := range mortos {
				c.Push = semInscricao(c.Push, e)
			}
			return nil
		})
	}
}

// avisarParceiro roda quando o dono conclui um pedido.
func (s *servidor) avisarParceiro(id string, quem parceiro, dono string, p pedido) {
	titulo := "Feito ✓"
	if dono != "" {
		titulo = dono + " fez ✓"
	}
	mortos := s.enviarPush(quem.Push, aviso{Titulo: titulo, Corpo: p.Texto, Tag: fmt.Sprintf("feito-%d", p.ID), URL: "../amor/"}, false)
	if len(mortos) > 0 {
		s.arm.alterar(id, func(c *conta) error {
			for i := range c.Parceiros {
				if c.Parceiros[i].ID == quem.ID {
					for _, e := range mortos {
						c.Parceiros[i].Push = semInscricao(c.Parceiros[i].Push, e)
					}
				}
			}
			return nil
		})
	}
}
