package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func montar(t *testing.T) (*httptest.Server, func(metodo, rota, chave string, corpo any) (int, map[string]any)) {
	arm, err := novoArmazem(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &servidor{arm: arm, prefixo: "/edna/api", limites: novoLimitador()}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)

	chamar := func(metodo, rota, chave string, corpo any) (int, map[string]any) {
		var leitor *strings.Reader
		if corpo != nil {
			b, _ := json.Marshal(corpo)
			leitor = strings.NewReader(string(b))
		} else {
			leitor = strings.NewReader("")
		}
		req, _ := http.NewRequest(metodo, srv.URL+"/edna/api"+rota, leitor)
		if chave != "" {
			req.Header.Set("Authorization", "Bearer "+chave)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var saida map[string]any
		json.NewDecoder(resp.Body).Decode(&saida)
		return resp.StatusCode, saida
	}
	return srv, chamar
}

func TestCaminhoInteiro(t *testing.T) {
	_, chamar := montar(t)

	// O dono cria a lista e recebe segredo + convite.
	st, conta := chamar("POST", "/contas", "", map[string]string{"nome": "Diego"})
	if st != 201 {
		t.Fatalf("criar conta: %d %v", st, conta)
	}
	segredo, convite := conta["segredo"].(string), conta["convite"].(string)

	// O parceiro entra pelo convite.
	st, entrada := chamar("POST", "/entrar", "", map[string]string{"convite": convite, "nome": "Nay"})
	if st != 200 || entrada["dono"] != "Diego" {
		t.Fatalf("entrar: %d %v", st, entrada)
	}
	token := entrada["token"].(string)

	// Convite errado não entra.
	if st, _ := chamar("POST", "/entrar", "", map[string]string{"convite": "v_000000000000.x"}); st != 404 {
		t.Errorf("convite falso entrou: %d", st)
	}

	// O parceiro manda um pedido urgente e um normal.
	st, p1 := chamar("POST", "/pedidos", token, map[string]any{"texto": "  buscar o remédio  da mãe ", "urgente": true})
	if st != 201 || p1["texto"] != "buscar o remédio da mãe" || p1["de"] != "Nay" {
		t.Fatalf("pedido: %d %v", st, p1)
	}
	chamar("POST", "/pedidos", token, map[string]any{"texto": "comprar pão"})

	// O dono vê os dois.
	if st, _ := chamar("GET", "/caixa", segredo, nil); st != 200 {
		t.Fatalf("caixa: %d", st)
	}

	// O parceiro não lê a caixa do dono; o dono não posta como parceiro.
	if st, _ := chamar("GET", "/caixa", token, nil); st != 401 {
		t.Errorf("parceiro leu a caixa do dono: %d", st)
	}
	if st, _ := chamar("POST", "/pedidos", segredo, map[string]any{"texto": "x"}); st != 401 {
		t.Errorf("segredo do dono postou como parceiro: %d", st)
	}

	// O dono conclui; o parceiro vê feito.
	id := int(p1["id"].(float64))
	if st, _ := chamar("POST", "/caixa/"+itoa(id)+"/feito", segredo, nil); st != 204 {
		t.Fatalf("feito: %d", st)
	}
	_, meus := chamar("GET", "/meus", token, nil)
	lista := meus["pedidos"].([]any)
	var feito bool
	for _, p := range lista {
		m := p.(map[string]any)
		if int(m["id"].(float64)) == id {
			feito = m["feito"].(bool)
		}
	}
	if !feito {
		t.Errorf("o parceiro não viu o pedido como feito: %v", lista)
	}

	// Desligar tira o parceiro e troca o convite.
	st, novo := chamar("POST", "/conta/desligar", segredo, nil)
	if st != 200 || novo["convite"] == convite {
		t.Fatalf("desligar: %d %v", st, novo)
	}
	if st, _ := chamar("POST", "/pedidos", token, map[string]any{"texto": "ainda dá?"}); st != 401 {
		t.Errorf("parceiro desligado continuou mandando: %d", st)
	}
	if st, _ := chamar("POST", "/entrar", "", map[string]string{"convite": convite}); st != 404 {
		t.Errorf("convite antigo ainda vale: %d", st)
	}
}

// Dois parceiros na mesma lista (esposa e filho): um não vê o pedido do outro,
// mesmo que os dois tenham o mesmo nome.
func TestParceiroNaoVeOPedidoDoOutro(t *testing.T) {
	_, chamar := montar(t)
	_, conta := chamar("POST", "/contas", "", map[string]string{"nome": "Diego"})
	convite := conta["convite"].(string)
	_, a := chamar("POST", "/entrar", "", map[string]string{"convite": convite, "nome": "Nay"})
	_, b := chamar("POST", "/entrar", "", map[string]string{"convite": convite, "nome": "Nay"})
	tokenA, tokenB := a["token"].(string), b["token"].(string)

	chamar("POST", "/pedidos", tokenA, map[string]any{"texto": "segredo da A"})
	chamar("POST", "/pedidos", tokenB, map[string]any{"texto": "segredo da B"})

	_, meusA := chamar("GET", "/meus", tokenA, nil)
	_, meusB := chamar("GET", "/meus", tokenB, nil)
	textos := func(m map[string]any) string {
		s := ""
		for _, p := range m["pedidos"].([]any) {
			s += p.(map[string]any)["texto"].(string) + ";"
		}
		return s
	}
	if textos(meusA) != "segredo da A;" || textos(meusB) != "segredo da B;" {
		t.Fatalf("vazou entre parceiros: A=%q B=%q", textos(meusA), textos(meusB))
	}
	// O dono vê os dois.
	_, caixa := chamar("GET", "/caixa", conta["segredo"].(string), nil)
	_ = caixa
}

func TestChavesNaoVaoParaODisco(t *testing.T) {
	arm, _ := novoArmazem(t.TempDir())
	s := &servidor{arm: arm, prefixo: "", limites: novoLimitador()}
	srv := httptest.NewServer(s)
	defer srv.Close()
	resp, _ := http.Post(srv.URL+"/contas", "application/json", strings.NewReader(`{"nome":"x"}`))
	var conta map[string]string
	json.NewDecoder(resp.Body).Decode(&conta)
	c, err := arm.ler(conta["conta"])
	if err != nil {
		t.Fatal(err)
	}
	if c.SegredoHash == conta["segredo"] || strings.Contains(c.SegredoHash, conta["segredo"][2:14]) {
		t.Fatal("o segredo foi gravado em claro")
	}
}

func TestAbrirChave(t *testing.T) {
	if _, _, ok := abrirChave("c_abc.def"); ok {
		t.Error("chave curta demais passou")
	}
	if _, _, ok := abrirChave("../../etc/passwd"); ok {
		t.Error("caminho passou como chave")
	}
	tipo, id, ok := abrirChave(novaChave("p", "0123456789ab"))
	if !ok || tipo != "p" || id != "0123456789ab" {
		t.Errorf("chave boa não abriu: %v %v %v", tipo, id, ok)
	}
}

func itoa(n int) string { return strconv.Itoa(n) }
