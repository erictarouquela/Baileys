# Baileys Web Panel

Fork do [Baileys](https://github.com/WhiskeySockets/Baileys) com um **painel web visual** para gerenciar conexoes WhatsApp. Conecte, desconecte e exclua multiplos numeros de forma simples, com QR code e codigo de pareamento em tempo real.

Feito para deploy no **EasyPanel** via Docker Compose.

## Funcionalidades

- **Conectar** — Adicione um numero via QR code ou codigo de pareamento
- **Desconectar** — Faz logout e invalida a sessao no WhatsApp
- **Excluir** — Remove a pasta de autenticacao do disco permanentemente
- **Multiplas instancias** — Gerencie varios numeros simultaneamente
- **Tempo real** — Atualizacoes via WebSocket (QR code, status, codigo de pareamento)
- **Dados persistentes** — Volume Docker para manter as sessoes entre deploys

## Deploy (EasyPanel / Docker)

```bash
git clone <seu-repo>
cd Baileys
docker compose up -d
```

Abra `http://localhost:3000`.

No **EasyPanel**, aponte para este repositorio — ele detecta o `docker-compose.yml` automaticamente e cria o volume `baileys-data` para persistencia.

### Portas

| Porta | Descricao |
|-------|-----------|
| 3000  | Painel web |

### Volumes

| Volume | Caminho no container | Descricao |
|--------|---------------------|-----------|
| `baileys-data` | `/app/data` | Dados de autenticacao das instancias |

## Uso

1. Acesse `http://seu-servidor:3000`
2. Clique em **Add Instance**
3. Digite o numero com codigo do pais (ex: `5511999999999`)
4. Escaneie o QR code com o WhatsApp **ou** marque "Use pairing code" para gerar um codigo
5. Apos conectar, o status muda para **Connected**
6. Use **Disconnect** para desconectar ou **Delete** para remover permanentemente

> **Nota sobre Delete**: Quando voce exclui uma instancia, a pasta `data/instances/{numero}/` e removida do disco. Isso apaga permanentemente as chaves de sessa. Para usar o mesmo numero novamente, voce precisara escanear um novo QR code.

## API

| Metodo | Rota | Descricao |
|--------|------|-----------|
| `GET` | `/api/instances` | Lista todas as instancias e seus status |
| `POST` | `/api/instances/:id/connect` | Inicia conexao. Body opcional: `{"phoneNumber": "5511999999999"}` |
| `POST` | `/api/instances/:id/disconnect` | Desconecta/logout |
| `DELETE` | `/api/instances/:id` | Exclui instancia + pasta de autenticacao |
| `GET` | `/api/instances/:id/qr-image` | QR code em PNG (para exibicao no frontend) |

### WebSocket

Conecte em `/ws` para receber eventos em tempo real:

| Evento | Payload |
|--------|---------|
| `status-update` | `{ id, status, qr, pairingCode, error }` |
| `qr-update` | `{ id, qr }` |
| `pairing-code` | `{ id, code }` |
| `instance-deleted` | `{ id }` |

## Estrutura do projeto

```
Baileys/
├── src/                    # Codigo fonte do Baileys (fork)
├── WAProto/                # Protobuf (gerado, nao editar)
├── web-panel/              # Painel web
│   ├── src/
│   │   ├── server.ts           # Servidor Express + WebSocket
│   │   ├── instance-manager.ts # Gerenciador de instancias
│   │   ├── routes/api.ts       # Rotas REST
│   │   └── public/index.html   # Frontend (SPA vanilla)
│   └── package.json
├── Dockerfile              # Build multi-stage
├── docker-compose.yml      # Deploy EasyPanel
└── data/                   # Dados de autenticacao (criado em runtime, nao versionado)
    └── instances/
        └── {numero}/
            ├── creds.json
            └── ...
```

## Desenvolvimento local

Pre-requisitos: Node >= 20, Corepack habilitado.

```bash
# Build do Baileys (necessario para o web-panel)
corepack enable
yarn install
yarn build

# Instalar e rodar o painel
cd web-panel
npm install
npm run dev      # Modo desenvolvimento com tsx
```

O painel estara em `http://localhost:3000`.

## Seguranca

- IDs de instancia sao validados no servidor (apenas digitos) — previne path traversal
- Dados de autenticacao (`data/`) nao sao versionados
- As credenciais do WhatsApp contem chaves Signal de longo prazo — trate `data/` como uma chave SSH privada

## Creditos

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp WebSocket library por Rajeh Taher
- Painel web construido com Express, WebSocket e vanilla HTML/CSS/JS
