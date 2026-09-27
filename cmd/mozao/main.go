// mozao — o ponto de encontro dos pedidos de "meu amor" na EDNA pública.
//
//	mozao --porta 8200 --dados /dados --prefixo /edna/api
//
// A EDNA grátis guarda tudo no aparelho da pessoa. A única coisa que não dá
// para fazer só no aparelho é um celular mandar pedido para o outro — para
// isso existe este servidor, e ele faz só isso: guarda pedidos curtos de
// texto e entrega para o dono da lista. Nenhum áudio passa por aqui (a voz é
// transcrita no celular de quem fala), nenhuma tarefa da lista do dono vem
// para cá, não há e-mail nem senha.
//
// Identidade é por chave, não por cadastro:
//
//	segredo  c_<conta>.<aleatório>  quem tem, é o dono da lista
//	convite  v_<conta>.<aleatório>  link que o dono manda para o parceiro
//	parceiro p_<conta>.<aleatório>  o que o parceiro guarda depois de entrar
//
// No disco ficam só os hashes; a chave em si vive no aparelho de cada um.
// Cada conta é um arquivo JSON em <dados>/contas/<conta>.json — para o volume
// de um app grátis isso é mais simples e mais fácil de copiar do que um banco.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const (
	maxTexto        = 400
	maxParceiros    = 5
	maxPedidosConta = 500
	guardaFeitos    = 30 * 24 * time.Hour
)

type parceiro struct {
	ID        string      `json:"id"` // derivado do token; é o que liga o pedido a quem mandou
	TokenHash string      `json:"token_hash"`
	Nome      string      `json:"nome"`
	Desde     time.Time   `json:"desde"`
	Push      []inscricao `json:"push,omitempty"` // aparelhos que querem saber do "feito"
}

type pedido struct {
	ID       int        `json:"id"`
	Texto    string     `json:"texto"`
	Urgente  bool       `json:"urgente"`
	De       string     `json:"de,omitempty"`
	Parceiro string     `json:"parceiro,omitempty"` // parceiro.ID de quem mandou
	Criado   time.Time  `json:"criado"`
	Feito    bool       `json:"feito"`
	FeitoEm  *time.Time `json:"feito_em,omitempty"`
}

type conta struct {
	ID          string      `json:"id"`
	Nome        string      `json:"nome"`
	SegredoHash string      `json:"segredo_hash"`
	ConviteHash string      `json:"convite_hash"`
	Parceiros   []parceiro  `json:"parceiros"`
	Pedidos     []pedido    `json:"pedidos"`
	ProximoID   int         `json:"proximo_id"`
	Criada      time.Time   `json:"criada"`
	Push        []inscricao `json:"push,omitempty"` // aparelhos do dono que recebem aviso
}

// --- guardar em disco ------------------------------------------------------------

type armazem struct {
	pasta   string
	mu      sync.Mutex
	trancas map[string]*sync.Mutex
}

var reID = regexp.MustCompile(`^[0-9a-f]{12}$`)

func novoArmazem(pasta string) (*armazem, error) {
	if err := os.MkdirAll(filepath.Join(pasta, "contas"), 0o700); err != nil {
		return nil, err
	}
	return &armazem{pasta: pasta, trancas: map[string]*sync.Mutex{}}, nil
}

func (a *armazem) tranca(id string) *sync.Mutex {
	a.mu.Lock()
	defer a.mu.Unlock()
	if m, ok := a.trancas[id]; ok {
		return m
	}
	m := &sync.Mutex{}
	a.trancas[id] = m
	return m
}

func (a *armazem) caminho(id string) string {
	return filepath.Join(a.pasta, "contas", id+".json")
}

var errNaoAchei = errors.New("conta não encontrada")

func (a *armazem) ler(id string) (*conta, error) {
	if !reID.MatchString(id) {
		return nil, errNaoAchei
	}
	b, err := os.ReadFile(a.caminho(id))
	if err != nil {
		return nil, errNaoAchei
	}
	var c conta
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// gravar escreve num temporário e renomeia: uma queda no meio nunca deixa
// o arquivo pela metade.
func (a *armazem) gravar(c *conta) error {
	b, err := json.MarshalIndent(c, "", " ")
	if err != nil {
		return err
	}
	tmp := a.caminho(c.ID) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, a.caminho(c.ID))
}

// alterar lê, aplica a mudança e grava, com a conta trancada.
func (a *armazem) alterar(id string, f func(*conta) error) (*conta, error) {
	m := a.tranca(id)
	m.Lock()
	defer m.Unlock()
	c, err := a.ler(id)
	if err != nil {
		return nil, err
	}
	if err := f(c); err != nil {
		return nil, err
	}
	return c, a.gravar(c)
}

// --- chaves ------------------------------------------------------------------------

func aleatorio(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func igual(hashGuardado, chave string) bool {
	return subtle.ConstantTimeCompare([]byte(hashGuardado), []byte(hash(chave))) == 1
}

// abrirChave separa "c_<conta>.<aleatório>" em (tipo, conta) — ou nada.
func abrirChave(chave string) (tipo, id string, ok bool) {
	if len(chave) < 4 || chave[1] != '_' {
		return "", "", false
	}
	tipo = chave[:1]
	resto := chave[2:]
	ponto := strings.IndexByte(resto, '.')
	if ponto < 0 {
		return "", "", false
	}
	id = resto[:ponto]
	if !reID.MatchString(id) || len(resto)-ponto-1 < 32 {
		return "", "", false
	}
	return tipo, id, true
}

func novaChave(tipo, id string) string {
	return tipo + "_" + id + "." + aleatorio(20)
}

// --- servidor -----------------------------------------------------------------------

type servidor struct {
	arm     *armazem
	prefixo string
	limites *limitador
	vapid   vapid
}

func main() {
	porta := flag.String("porta", "8200", "porta")
	dados := flag.String("dados", "dados", "pasta dos dados")
	prefixo := flag.String("prefixo", "/edna/api", "prefixo das rotas")
	flag.Parse()

	arm, err := novoArmazem(*dados)
	if err != nil {
		log.Fatal(err)
	}
	v, err := carregarVAPID(*dados)
	if err != nil {
		log.Fatal(err)
	}
	s := &servidor{arm: arm, prefixo: strings.TrimRight(*prefixo, "/"), limites: novoLimitador(), vapid: v}
	go s.faxinaSempre()

	l, err := net.Listen("tcp", "0.0.0.0:"+*porta)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("mozao em :%s%s (dados em %s)", *porta, s.prefixo, *dados)
	// Prazos curtos: um cliente que abre a conexão e não manda nada não pode
	// segurar o servidor (é 1 vCPU para todo mundo).
	srv := &http.Server{
		Handler:           s,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Fatal(srv.Serve(l))
}

func (s *servidor) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	rota := strings.TrimPrefix(r.URL.Path, s.prefixo)
	if rota == r.URL.Path && s.prefixo != "" {
		http.NotFound(w, r)
		return
	}
	partes := strings.Split(strings.Trim(rota, "/"), "/")

	switch {
	case r.Method == "POST" && rota == "/contas":
		s.criarConta(w, r)
	case r.Method == "POST" && rota == "/entrar":
		s.entrar(w, r)
	case rota == "/saude":
		fmt.Fprintln(w, "ok")
	case r.Method == "GET" && rota == "/vapid":
		s.chavePush(w, r)
	case rota == "/conta/push" && (r.Method == "POST" || r.Method == "DELETE"):
		s.comoDono(w, r, s.pushDono)
	case rota == "/meus/push" && (r.Method == "POST" || r.Method == "DELETE"):
		s.comoParceiro(w, r, s.pushParceiro)

	// --- lado do dono (Bearer c_…) ---
	case r.Method == "GET" && rota == "/conta":
		s.comoDono(w, r, s.verConta)
	case r.Method == "POST" && rota == "/conta/nome":
		s.comoDono(w, r, s.mudarNome)
	case r.Method == "POST" && rota == "/conta/convite":
		s.comoDono(w, r, s.novoConvite)
	case r.Method == "POST" && rota == "/conta/desligar":
		s.comoDono(w, r, s.desligarParceiros)
	case r.Method == "GET" && rota == "/caixa":
		s.comoDono(w, r, s.caixa)
	case len(partes) == 3 && partes[0] == "caixa" && r.Method == "POST":
		s.comoDono(w, r, func(w http.ResponseWriter, r *http.Request, id string) { s.mudarPedido(w, r, id, partes[1], partes[2]) })
	case len(partes) == 2 && partes[0] == "caixa" && r.Method == "DELETE":
		s.comoDono(w, r, func(w http.ResponseWriter, r *http.Request, id string) { s.mudarPedido(w, r, id, partes[1], "apagar") })

	// --- lado do parceiro (Bearer p_…) ---
	case r.Method == "GET" && rota == "/meus":
		s.comoParceiro(w, r, s.meus)
	case r.Method == "POST" && rota == "/pedidos":
		s.comoParceiro(w, r, s.novoPedido)
	default:
		http.NotFound(w, r)
	}
}

func escrever(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func erro(w http.ResponseWriter, status int, msg string) {
	escrever(w, status, map[string]string{"erro": msg})
}

func lerJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(v); err != nil {
		erro(w, http.StatusBadRequest, "pedido ilegível")
		return false
	}
	return true
}

func chaveDoPedido(r *http.Request) string {
	return strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func ipDe(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func limparNome(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 40 {
		s = string([]rune(s)[:40])
	}
	return s
}

func limparTexto(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > maxTexto {
		s = string([]rune(s)[:maxTexto]) + "…"
	}
	return s
}

// --- criar conta e entrar -----------------------------------------------------------

func (s *servidor) criarConta(w http.ResponseWriter, r *http.Request) {
	// Conta é grátis e sem cadastro: o freio por IP é o que impede um script
	// de encher o disco.
	if !s.limites.permite("contas:"+ipDe(r), 10, time.Hour) {
		erro(w, http.StatusTooManyRequests, "muitas contas criadas deste endereço — tenta mais tarde")
		return
	}
	var corpo struct {
		Nome string `json:"nome"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	id := aleatorio(6)
	segredo, convite := novaChave("c", id), novaChave("v", id)
	c := &conta{
		ID: id, Nome: limparNome(corpo.Nome), SegredoHash: hash(segredo), ConviteHash: hash(convite),
		Parceiros: []parceiro{}, Pedidos: []pedido{}, ProximoID: 1, Criada: time.Now(),
	}
	if _, err := os.Stat(s.arm.caminho(id)); err == nil {
		erro(w, http.StatusInternalServerError, "tenta de novo")
		return
	}
	if err := s.arm.gravar(c); err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar a conta")
		return
	}
	escrever(w, http.StatusCreated, map[string]string{"conta": id, "segredo": segredo, "convite": convite})
}

func (s *servidor) entrar(w http.ResponseWriter, r *http.Request) {
	if !s.limites.permite("entrar:"+ipDe(r), 30, time.Hour) {
		erro(w, http.StatusTooManyRequests, "espera um pouquinho")
		return
	}
	var corpo struct {
		Convite string `json:"convite"`
		Nome    string `json:"nome"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	tipo, id, ok := abrirChave(corpo.Convite)
	if !ok || tipo != "v" {
		erro(w, http.StatusNotFound, "esse convite não existe")
		return
	}
	token := novaChave("p", id)
	var dono string
	_, err := s.arm.alterar(id, func(c *conta) error {
		if !igual(c.ConviteHash, corpo.Convite) {
			return errNaoAchei
		}
		if len(c.Parceiros) >= maxParceiros {
			return errors.New("essa lista já tem gente demais")
		}
		c.Parceiros = append(c.Parceiros, parceiro{ID: hash(token)[:12], TokenHash: hash(token), Nome: limparNome(corpo.Nome), Desde: time.Now()})
		dono = c.Nome
		return nil
	})
	if errors.Is(err, errNaoAchei) {
		erro(w, http.StatusNotFound, "esse convite não vale mais")
		return
	}
	if err != nil {
		erro(w, http.StatusBadRequest, err.Error())
		return
	}
	escrever(w, http.StatusOK, map[string]string{"token": token, "dono": dono})
}

// --- lado do dono ----------------------------------------------------------------------

func (s *servidor) comoDono(w http.ResponseWriter, r *http.Request, f func(http.ResponseWriter, *http.Request, string)) {
	chave := chaveDoPedido(r)
	tipo, id, ok := abrirChave(chave)
	if !ok || tipo != "c" {
		erro(w, http.StatusUnauthorized, "sem chave")
		return
	}
	c, err := s.arm.ler(id)
	if err != nil || !igual(c.SegredoHash, chave) {
		erro(w, http.StatusUnauthorized, "chave inválida")
		return
	}
	f(w, r, id)
}

func (s *servidor) verConta(w http.ResponseWriter, r *http.Request, id string) {
	c, err := s.arm.ler(id)
	if err != nil {
		erro(w, http.StatusNotFound, "conta sumiu")
		return
	}
	nomes := []string{}
	for _, p := range c.Parceiros {
		nomes = append(nomes, p.Nome)
	}
	escrever(w, http.StatusOK, map[string]any{"conta": c.ID, "nome": c.Nome, "parceiros": nomes})
}

func (s *servidor) mudarNome(w http.ResponseWriter, r *http.Request, id string) {
	var corpo struct {
		Nome string `json:"nome"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	if _, err := s.arm.alterar(id, func(c *conta) error { c.Nome = limparNome(corpo.Nome); return nil }); err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// novoConvite troca o link: o antigo para de funcionar, quem já entrou continua.
func (s *servidor) novoConvite(w http.ResponseWriter, r *http.Request, id string) {
	convite := novaChave("v", id)
	if _, err := s.arm.alterar(id, func(c *conta) error { c.ConviteHash = hash(convite); return nil }); err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar")
		return
	}
	escrever(w, http.StatusOK, map[string]string{"convite": convite})
}

// desligarParceiros tira todo mundo e troca o convite — o botão de emergência.
func (s *servidor) desligarParceiros(w http.ResponseWriter, r *http.Request, id string) {
	convite := novaChave("v", id)
	if _, err := s.arm.alterar(id, func(c *conta) error {
		c.Parceiros = []parceiro{}
		c.ConviteHash = hash(convite)
		return nil
	}); err != nil {
		erro(w, http.StatusInternalServerError, "não consegui guardar")
		return
	}
	escrever(w, http.StatusOK, map[string]string{"convite": convite})
}

func (s *servidor) caixa(w http.ResponseWriter, r *http.Request, id string) {
	c, err := s.arm.ler(id)
	if err != nil {
		erro(w, http.StatusNotFound, "conta sumiu")
		return
	}
	escrever(w, http.StatusOK, ordenados(c.Pedidos))
}

func (s *servidor) mudarPedido(w http.ResponseWriter, r *http.Request, id, pedidoID, acao string) {
	n, err := strconv.Atoi(pedidoID)
	if err != nil {
		erro(w, http.StatusBadRequest, "id inválido")
		return
	}
	achou := false
	var feito *pedido
	var avisar parceiro
	var dono string
	_, err = s.arm.alterar(id, func(c *conta) error {
		for i := range c.Pedidos {
			if c.Pedidos[i].ID != n {
				continue
			}
			achou = true
			switch acao {
			case "feito":
				agora := time.Now()
				c.Pedidos[i].Feito, c.Pedidos[i].FeitoEm = true, &agora
				cp := c.Pedidos[i]
				feito, dono = &cp, c.Nome
				for _, p := range c.Parceiros {
					if p.ID == cp.Parceiro {
						avisar = p
					}
				}
			case "reabrir":
				c.Pedidos[i].Feito, c.Pedidos[i].FeitoEm = false, nil
			case "apagar":
				c.Pedidos = append(c.Pedidos[:i], c.Pedidos[i+1:]...)
			default:
				return errors.New("ação desconhecida")
			}
			return nil
		}
		return nil
	})
	if err != nil {
		erro(w, http.StatusBadRequest, err.Error())
		return
	}
	if !achou {
		erro(w, http.StatusNotFound, "pedido não existe")
		return
	}
	if feito != nil && len(avisar.Push) > 0 {
		go s.avisarParceiro(id, avisar, dono, *feito)
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- lado do parceiro ---------------------------------------------------------------------

// comoParceiro entrega ao handler a conta e o parceiro autenticado — é o
// parceiro (não só o nome, que pode repetir) que separa o que cada um vê.
func (s *servidor) comoParceiro(w http.ResponseWriter, r *http.Request, f func(http.ResponseWriter, *http.Request, string, parceiro)) {
	chave := chaveDoPedido(r)
	tipo, id, ok := abrirChave(chave)
	if !ok || tipo != "p" {
		erro(w, http.StatusUnauthorized, "sem chave")
		return
	}
	c, err := s.arm.ler(id)
	if err != nil {
		erro(w, http.StatusUnauthorized, "chave inválida")
		return
	}
	for _, p := range c.Parceiros {
		if igual(p.TokenHash, chave) {
			f(w, r, id, p)
			return
		}
	}
	erro(w, http.StatusUnauthorized, "você foi desligado desta lista")
}

// meus devolve só os pedidos deste parceiro: numa lista com mais gente (a
// esposa e os filhos, por exemplo), um não vê o que o outro pediu.
func (s *servidor) meus(w http.ResponseWriter, r *http.Request, id string, quem parceiro) {
	c, err := s.arm.ler(id)
	if err != nil {
		erro(w, http.StatusNotFound, "conta sumiu")
		return
	}
	so := []pedido{}
	for _, p := range c.Pedidos {
		if p.Parceiro == quem.ID {
			so = append(so, p)
		}
	}
	escrever(w, http.StatusOK, map[string]any{"dono": c.Nome, "pedidos": ordenados(so)})
}

func (s *servidor) novoPedido(w http.ResponseWriter, r *http.Request, id string, quem parceiro) {
	if !s.limites.permite("pedidos:"+id, 60, time.Hour) {
		erro(w, http.StatusTooManyRequests, "muitos pedidos em pouco tempo — espera um pouquinho")
		return
	}
	var corpo struct {
		Texto   string `json:"texto"`
		Urgente bool   `json:"urgente"`
	}
	if !lerJSON(w, r, &corpo) {
		return
	}
	texto := limparTexto(corpo.Texto)
	if texto == "" {
		erro(w, http.StatusBadRequest, "o pedido veio vazio")
		return
	}
	var novo pedido
	c, err := s.arm.alterar(id, func(c *conta) error {
		if len(c.Pedidos) >= maxPedidosConta {
			return errors.New("a lista está cheia — o dono precisa concluir alguns pedidos")
		}
		novo = pedido{ID: c.ProximoID, Texto: texto, Urgente: corpo.Urgente, De: quem.Nome, Parceiro: quem.ID, Criado: time.Now()}
		c.ProximoID++
		c.Pedidos = append(c.Pedidos, novo)
		return nil
	})
	if err != nil {
		erro(w, http.StatusBadRequest, err.Error())
		return
	}
	go s.avisarDono(id, append([]inscricao{}, c.Push...), novo)
	escrever(w, http.StatusCreated, novo)
}

// ordenados: abertos primeiro (urgente no topo, depois por chegada); feitos
// depois, mais recente em cima.
func ordenados(ps []pedido) []pedido {
	lista := append([]pedido{}, ps...)
	sort.SliceStable(lista, func(i, j int) bool {
		a, b := lista[i], lista[j]
		if a.Feito != b.Feito {
			return !a.Feito
		}
		if !a.Feito {
			if a.Urgente != b.Urgente {
				return a.Urgente
			}
			return a.Criado.Before(b.Criado)
		}
		return a.Criado.After(b.Criado)
	})
	return lista
}

// --- faxina ------------------------------------------------------------------------------

// faxinaSempre tira os pedidos feitos há mais de 30 dias. Contas sem uso
// ficam: são só um arquivo pequeno, e ninguém perde a lista por férias.
func (s *servidor) faxinaSempre() {
	for {
		time.Sleep(6 * time.Hour)
		arquivos, _ := os.ReadDir(filepath.Join(s.arm.pasta, "contas"))
		for _, a := range arquivos {
			id := strings.TrimSuffix(a.Name(), ".json")
			if !reID.MatchString(id) {
				continue
			}
			s.arm.alterar(id, func(c *conta) error {
				corte := time.Now().Add(-guardaFeitos)
				vivos := c.Pedidos[:0]
				for _, p := range c.Pedidos {
					if !p.Feito || p.FeitoEm == nil || p.FeitoEm.After(corte) {
						vivos = append(vivos, p)
					}
				}
				c.Pedidos = vivos
				return nil
			})
		}
	}
}

// --- freio ---------------------------------------------------------------------------------

type limitador struct {
	mu     sync.Mutex
	marcas map[string][]time.Time
}

func novoLimitador() *limitador {
	return &limitador{marcas: map[string][]time.Time{}}
}

func (l *limitador) permite(chave string, max int, janela time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	agora := time.Now()
	vivas := l.marcas[chave][:0]
	for _, m := range l.marcas[chave] {
		if agora.Sub(m) < janela {
			vivas = append(vivas, m)
		}
	}
	if len(vivas) >= max {
		l.marcas[chave] = vivas
		return false
	}
	l.marcas[chave] = append(vivas, agora)
	// Não deixa o mapa crescer para sempre com IPs que passaram uma vez.
	if len(l.marcas) > 10000 {
		for k, v := range l.marcas {
			if len(v) == 0 || agora.Sub(v[len(v)-1]) > janela {
				delete(l.marcas, k)
			}
		}
	}
	return true
}
