# 📊 JA System — Events Dashboard

![Build Status](https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18.x_%7C_20.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)

> **JA System — Módulo de Dashboard Operacional & Financeiro de Eventos**  
> Painel em tempo real e consolidação analítica para acompanhamento de orçamentos, propostas, margem financeira e fluxo operacional da **JA Promoções & Eventos**.

---

## 📋 Sumário
1. [Visão Geral da Arquitetura](#-visão-geral-da-arquitetura)
2. [Principais Funcionalidades](#-principais-funcionalidades)
3. [Estrutura do Projeto](#-estrutura-do-projeto)
4. [Pré-requisitos e Ambiente](#-pré-requisitos-e-ambiente)
5. [Variáveis de Ambiente (`.env`)](#-variáveis-de-ambiente-env)
6. [Instalação e Execução](#-instalação-e-execução)
7. [Manual do Desenvolvedor (Workflow)](#-manual-do-desenvolvedor-workflow)
8. [Rotas e APIs](#-rotas-e-apis)
9. [WebSockets & Eventos em Tempo Real](#-websockets--eventos-em-tempo-real)
10. [Convenções de Código e Boas Práticas](#-convenções-de-código-e-boas-práticas)

---

## 🚀 Visão Geral da Arquitetura

O **Events Dashboard** é a camada analítica e visual integrante do ecossistema **JA System**. Ele consolida em um único painel a saúde financeira de feiras, estandes e eventos corporativos, reduzindo o tempo de tomada de decisão e automatizando métricas de lucratividade.

### Tech Stack
* **Runtime:** Node.js (v18+ LTS recomendado)
* **API Framework:** Express.js
* **Banco de Dados:** PostgreSQL
* **Realtime Communication:** Socket.io / WebSockets (atualizações dinâmicas em tempo real)
* **Frontend:** HTML5, CSS3 / Tailwind CSS, JavaScript Moderno (ES6+) ou integração SPA

---

## 💡 Principais Funcionalidades

- **📈 Indicadores de Desempenho (KPIs):** Receita total prévia vs. realizada, margem líquida, custos operacionais por evento.
- **📑 Status de Propostas & Orçamentos:** Acompanhamento dinâmico do funil de aprovação (Rascunho, Enviado, Aprovado, Em Execução, Finalizado).
- **⚡ Atualização em Tempo Real via Socket.io:** Modificações financeiras ou aprovações efetuadas por usuários impactam os dashboards conectados instantaneamente.
- **📄 Emissão & Exportação de PDF:** Visualização rápida de resumos executivos e relatórios orçamentários.
- **🔔 Notificações Financeiras:** Alertas visuais para orçamentos pendentes, estouros de custos e alterações de prazos.

---

## 📂 Estrutura do Projeto

```text
Events-dashboard/
├── bin/                   # Scripts de inicialização e bootstrap do servidor
├── config/                # Configurações de Banco de Dados, Sockets e App
│   ├── database.js        # Pool de conexão PostgreSQL
│   └── socket.js          # Inicialização do servidor Socket.io
├── src/
│   ├── controllers/       # Regra de orquestração e tratamento de requisições
│   ├── services/          # Regras de negócio, cálculos financeiros e agregadores
│   ├── models/            # Definição de Schemas / Consultas SQL
│   ├── routes/            # Definição dos endpoints REST
│   ├── middlewares/       # Tratamento de erros, Autenticação e CORS
│   ├── sockets/           # Disparadores e listeners de eventos WebSocket
│   └── utils/             # Formatadores (Moeda BRL, Datas) e geradores de PDF
├── public/                # Assets estáticos, CSS, JS frontend e visões do dashboard
├── .env.example           # Modelo de variáveis de ambiente
├── .gitignore             # Arquivos ignorados pelo Git
├── package.json           # Dependências e scripts npm
└── README.md              # Documentação oficial do repositório
