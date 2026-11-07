import type { Language } from './LanguageContext';

interface PillarCopy {
  name: string;
  question: string;
  desc: string;
}

interface LadderLevel {
  name: string;
  how: string;
  status: string;
}

interface RoadmapStep {
  name: string;
  desc: string;
}

export interface LandingCopy {
  cta: { primary: string; secondary: string; closingTitle: string; closingDesc: string };
  whyNow: {
    eyebrow: string;
    title: string;
    traditionalLabel: string;
    traditionalFlow: string[];
    agenticLabel: string;
    agentExamples: string;
    agenticFlow: string[];
    body: string;
  };
  pillars: {
    eyebrow: string;
    title: string;
    subtitle: string;
    detect: PillarCopy;
    observe: PillarCopy;
    authorize: PillarCopy;
    manifest: PillarCopy;
    policiesTitle: string;
    policyObserve: string;
    policyManifest: string;
    policyBlock: string;
    defaultTag: string;
    ladderTitle: string;
    declared: LadderLevel;
    verified: LadderLevel;
    signed: LadderLevel;
  };
  roadmap: {
    eyebrow: string;
    title: string;
    subtitle: string;
    tag: string;
    identity: RoadmapStep;
    capabilities: RoadmapStep;
    payments: RoadmapStep;
  };
  install: {
    eyebrow: string;
    title: string;
    subtitle: string;
    codeTitle: string;
    previewLabel: string;
    license: string;
    note: string;
  };
}

export const LANDING_COPY: Record<Language, LandingCopy> = {
  en: {
    cta: {
      primary: 'Get your API key',
      secondary: 'Read the docs',
      closingTitle: 'The control layer between your website and AI agents.',
      closingDesc: 'Free for 250 agent events a month. No DNS change, same page for humans.',
    },
    whyNow: {
      eyebrow: 'Why now',
      title: 'The audience of your website is changing',
      traditionalLabel: 'Traditional web',
      traditionalFlow: ['Human', 'Browser', 'Website'],
      agenticLabel: 'Agentic web',
      agentExamples: 'ChatGPT, Claude, Perplexity, custom bots',
      agenticFlow: ['AI agent', 'Website', 'StealthMark policy'],
      body: 'Requests from agents that identify themselves already show up in server logs, reading pages to index content for AI answers. What logs do not give site owners is a per-agent view of that traffic: which agents visit, what they read and what they are allowed to take. StealthMark adds that view, and a policy you control.',
    },
    pillars: {
      eyebrow: 'What it does',
      title: 'Detect, observe, authorize, manifest',
      subtitle: 'Four steps from not knowing who reads your site to deciding what agents can do with it.',
      detect: {
        name: 'Detect',
        question: 'Who is reading your site',
        desc: 'Recognizes agents that identify themselves: the Accept: application/agent+json header, the x-stealthmark-agent header and known crawler User-Agents such as GPTBot and ClaudeBot.',
      },
      observe: {
        name: 'Observe',
        question: 'What they read',
        desc: 'Records one event per agent request. The console shows activity per agent and per route. Humans are never counted.',
      },
      authorize: {
        name: 'Authorize',
        question: 'What they are allowed to do',
        desc: 'Pick the policy for agent traffic. Human visitors get the same page.',
      },
      manifest: {
        name: 'Manifest',
        question: 'What capabilities you expose',
        desc: 'Serve a machine-readable manifest so agents can read what your site offers instead of guessing from the HTML.',
      },
      policiesTitle: 'Policies',
      policyObserve: 'The site answers normally and every agent visit is recorded.',
      policyManifest: 'Agents receive a machine-readable agent manifest.',
      policyBlock: 'Agents receive a 403.',
      defaultTag: 'default',
      ladderTitle: 'Know Your Agent ladder',
      declared: { name: 'Declared', how: 'User-Agent or header', status: 'Shipped' },
      verified: { name: 'Verified', how: 'Published IP ranges of OpenAI, Anthropic and Google', status: 'Roadmap' },
      signed: { name: 'Signed', how: 'Web Bot Auth', status: 'Roadmap' },
    },
    roadmap: {
      eyebrow: 'Roadmap',
      title: 'Where this goes',
      subtitle: 'None of these steps is shipped. Today StealthMark detects, observes, authorizes and publishes a manifest.',
      tag: 'Roadmap',
      identity: { name: 'Identity', desc: 'Signed agents with Web Bot Auth, so you know an agent is who it says it is.' },
      capabilities: { name: 'Capability enforcement', desc: 'Authentication, approval and metering of the actions declared in your manifest.' },
      payments: { name: 'Payments', desc: 'Charge agents for access to your content.' },
    },
    install: {
      eyebrow: 'Install',
      title: 'Two lines in your Next.js middleware',
      subtitle: 'No DNS change, no origin rewrite, same page for humans. Adapters for Express and Fastify work the same way.',
      codeTitle: 'middleware.ts',
      previewLabel: 'Available on npm: @stealthmark/next',
      license: 'Apache-2.0',
      note: 'Open-source middleware plus a hosted console. Free for 250 agent events a month.',
    },
  },
  es: {
    cta: {
      primary: 'Obtén tu API key',
      secondary: 'Lee la documentación',
      closingTitle: 'La capa de control entre tu sitio web y los agentes de IA.',
      closingDesc: 'Gratis hasta 250 eventos de agentes al mes. Sin cambios de DNS, misma página para humanos.',
    },
    whyNow: {
      eyebrow: 'Por qué ahora',
      title: 'La audiencia de tu sitio web está cambiando',
      traditionalLabel: 'Web tradicional',
      traditionalFlow: ['Persona', 'Navegador', 'Sitio web'],
      agenticLabel: 'Web de agentes',
      agentExamples: 'ChatGPT, Claude, Perplexity, bots propios',
      agenticFlow: ['Agente de IA', 'Sitio web', 'Política de StealthMark'],
      body: 'Las solicitudes de agentes que se identifican ya aparecen en los logs del servidor: leen páginas para indexar contenido en respuestas de IA. Lo que los logs no les dan a los dueños de sitios es una vista por agente de ese tráfico: qué agentes visitan, qué leen y qué se les permite llevarse. StealthMark agrega esa vista y una política que tú controlas.',
    },
    pillars: {
      eyebrow: 'Qué hace',
      title: 'Detectar, observar, autorizar, publicar el manifiesto',
      subtitle: 'Cuatro pasos para pasar de no saber quién lee tu sitio a decidir qué pueden hacer los agentes con él.',
      detect: {
        name: 'Detectar',
        question: 'Quién lee tu sitio',
        desc: 'Reconoce a los agentes que se identifican: el header Accept: application/agent+json, el header x-stealthmark-agent y User-Agents de crawlers conocidos como GPTBot y ClaudeBot.',
      },
      observe: {
        name: 'Observar',
        question: 'Qué leen',
        desc: 'Registra un evento por cada solicitud de un agente. La consola muestra la actividad por agente y por ruta. Las personas nunca se cuentan.',
      },
      authorize: {
        name: 'Autorizar',
        question: 'Qué pueden hacer',
        desc: 'Elige la política para el tráfico de agentes. Las visitas humanas reciben la misma página.',
      },
      manifest: {
        name: 'Manifiesto',
        question: 'Qué capacidades expones',
        desc: 'Sirve un manifiesto legible por máquinas para que los agentes lean lo que ofrece tu sitio en lugar de adivinarlo desde el HTML.',
      },
      policiesTitle: 'Políticas',
      policyObserve: 'El sitio responde con normalidad y se registra cada visita de agentes.',
      policyManifest: 'Los agentes reciben un manifiesto de agente legible por máquinas.',
      policyBlock: 'Los agentes reciben un 403.',
      defaultTag: 'por defecto',
      ladderTitle: 'Escala Know Your Agent',
      declared: { name: 'Declarado', how: 'User-Agent o header', status: 'Disponible' },
      verified: { name: 'Verificado', how: 'Rangos de IP publicados por OpenAI, Anthropic y Google', status: 'Roadmap' },
      signed: { name: 'Firmado', how: 'Web Bot Auth', status: 'Roadmap' },
    },
    roadmap: {
      eyebrow: 'Roadmap',
      title: 'Hacia dónde vamos',
      subtitle: 'Ninguno de estos pasos está disponible todavía. Hoy StealthMark detecta, observa, autoriza y publica un manifiesto.',
      tag: 'Roadmap',
      identity: { name: 'Identidad', desc: 'Agentes firmados con Web Bot Auth, para saber que un agente es quien dice ser.' },
      capabilities: { name: 'Aplicación de capacidades', desc: 'Autenticación, aprobación y medición de las acciones declaradas en tu manifiesto.' },
      payments: { name: 'Pagos', desc: 'Cobrar a los agentes por acceder a tu contenido.' },
    },
    install: {
      eyebrow: 'Instalación',
      title: 'Dos líneas en tu middleware de Next.js',
      subtitle: 'Sin cambios de DNS, sin reescribir el origen, misma página para humanos. Los adaptadores de Express y Fastify funcionan igual.',
      codeTitle: 'middleware.ts',
      previewLabel: 'Disponible en npm: @stealthmark/next',
      license: 'Apache-2.0',
      note: 'Middleware de código abierto más una consola alojada. Gratis hasta 250 eventos de agentes al mes.',
    },
  },
  pt: {
    cta: {
      primary: 'Obtenha sua API key',
      secondary: 'Leia a documentação',
      closingTitle: 'A camada de controle entre o seu site e os agentes de IA.',
      closingDesc: 'Grátis até 250 eventos de agentes por mês. Sem mudança de DNS, mesma página para humanos.',
    },
    whyNow: {
      eyebrow: 'Por que agora',
      title: 'A audiência do seu site está mudando',
      traditionalLabel: 'Web tradicional',
      traditionalFlow: ['Pessoa', 'Navegador', 'Site'],
      agenticLabel: 'Web de agentes',
      agentExamples: 'ChatGPT, Claude, Perplexity, bots próprios',
      agenticFlow: ['Agente de IA', 'Site', 'Política do StealthMark'],
      body: 'Requisições de agentes que se identificam já aparecem nos logs do servidor: eles leem páginas para indexar conteúdo em respostas de IA. O que os logs não dão aos donos de sites é uma visão por agente desse tráfego: quais agentes visitam, o que leem e o que podem levar. O StealthMark adiciona essa visão e uma política que você controla.',
    },
    pillars: {
      eyebrow: 'O que faz',
      title: 'Detectar, observar, autorizar, publicar o manifesto',
      subtitle: 'Quatro passos para sair de não saber quem lê seu site e passar a decidir o que os agentes podem fazer com ele.',
      detect: {
        name: 'Detectar',
        question: 'Quem lê seu site',
        desc: 'Reconhece agentes que se identificam: o header Accept: application/agent+json, o header x-stealthmark-agent e User-Agents de crawlers conhecidos como GPTBot e ClaudeBot.',
      },
      observe: {
        name: 'Observar',
        question: 'O que eles leem',
        desc: 'Registra um evento por requisição de agente. O console mostra a atividade por agente e por rota. Pessoas nunca são contadas.',
      },
      authorize: {
        name: 'Autorizar',
        question: 'O que podem fazer',
        desc: 'Escolha a política para o tráfego de agentes. Visitas humanas recebem a mesma página.',
      },
      manifest: {
        name: 'Manifesto',
        question: 'Quais capacidades você expõe',
        desc: 'Entregue um manifesto legível por máquinas para que os agentes leiam o que seu site oferece em vez de adivinhar pelo HTML.',
      },
      policiesTitle: 'Políticas',
      policyObserve: 'O site responde normalmente e cada visita de agente é registrada.',
      policyManifest: 'Os agentes recebem um manifesto de agente legível por máquinas.',
      policyBlock: 'Os agentes recebem um 403.',
      defaultTag: 'padrão',
      ladderTitle: 'Escada Know Your Agent',
      declared: { name: 'Declarado', how: 'User-Agent ou header', status: 'Disponível' },
      verified: { name: 'Verificado', how: 'Faixas de IP publicadas por OpenAI, Anthropic e Google', status: 'Roadmap' },
      signed: { name: 'Assinado', how: 'Web Bot Auth', status: 'Roadmap' },
    },
    roadmap: {
      eyebrow: 'Roadmap',
      title: 'Para onde isso vai',
      subtitle: 'Nenhum destes passos está disponível ainda. Hoje o StealthMark detecta, observa, autoriza e publica um manifesto.',
      tag: 'Roadmap',
      identity: { name: 'Identidade', desc: 'Agentes assinados com Web Bot Auth, para saber que um agente é quem diz ser.' },
      capabilities: { name: 'Aplicação de capacidades', desc: 'Autenticação, aprovação e medição das ações declaradas no seu manifesto.' },
      payments: { name: 'Pagamentos', desc: 'Cobrar dos agentes pelo acesso ao seu conteúdo.' },
    },
    install: {
      eyebrow: 'Instalação',
      title: 'Duas linhas no seu middleware do Next.js',
      subtitle: 'Sem mudança de DNS, sem reescrever a origem, mesma página para humanos. Os adaptadores de Express e Fastify funcionam do mesmo jeito.',
      codeTitle: 'middleware.ts',
      previewLabel: 'Disponível no npm: @stealthmark/next',
      license: 'Apache-2.0',
      note: 'Middleware de código aberto mais um console hospedado. Grátis até 250 eventos de agentes por mês.',
    },
  },
};
