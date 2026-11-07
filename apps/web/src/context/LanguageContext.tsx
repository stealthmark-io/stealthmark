'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

import { LANDING_COPY, type LandingCopy } from './landingCopy';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

export type Language = 'en' | 'es' | 'pt';

export interface Translations {
  nav: {
    scanner: string;
    platform: string;
    blueprint: string;
    benchmark: string;
    pricing: string;
    docs: string;
    launchConsole: string;
    tickerStatus: string;
    tickerDesc: string;
  };
  hero: {
    pill: string;
    h1Part1: string;
    h1Part2: string;
    desc: string;
    bento1Title: string;
    bento1Desc: string;
    bento2Title: string;
    bento2Desc: string;
    bento3Title: string;
    bento3Desc: string;
    bento4Title: string;
    bento4Desc: string;
  };
  scanner: {
    badge: string;
    title: string;
    subtitle: string;
    installTitle: string;
    installDesc: string;
    testTitle: string;
    testDesc: string;
    seeTitle: string;
    seeDesc: string;
    columnsTitle: string;
    metrics: {
      payload: string;
      tokens: string;
      waste: string;
      waf: string;
    };
    limits: string;
    safeHarbor: string;
    btnDocs: string;
  };
  landing: LandingCopy;
  blueprint: {
    backToHome: string;
    badge: string;
    title: string;
    subtitle: string;
    withoutStealthmark: string;
    withStealthmark: string;
  };
}

export const DICTIONARIES: Record<Language, Translations> = {
  en: {
    nav: {
      scanner: 'Auditor',
      platform: 'Product',
      blueprint: 'Policies',
      benchmark: 'Compare',
      pricing: 'Pricing',
      docs: 'Docs',
      launchConsole: 'Launch Console',
      tickerStatus: '60-POINT SURFACE AUDIT LIVE',
      tickerDesc: 'Instant passive cybersecurity, CVE-2026-111497 (Brotli/Node2Shell), OWASP Top 10:2025 & secret-leak reconnaissance. Zero registration.',
    },
    hero: {
      pill: 'Two-line install · No DNS change · Same page for humans',
      h1Part1: "Your website wasn't built for AI agents.",
      h1Part2: 'StealthMark was.',
      desc: `The control layer between your website and AI agents. Audit your domain across ${SCAN_CHECK_COUNT} perimeter, CVE, DNS, and AI-surface checks in seconds—or install the SDK to identify AI agents, set what they can access, and publish machine-readable manifests.`,
      bento1Title: 'Detect',
      bento1Desc: 'Who is reading your site',
      bento2Title: 'Observe',
      bento2Desc: 'What they read',
      bento3Title: 'Authorize',
      bento3Desc: 'What they are allowed to do',
      bento4Title: 'Manifest',
      bento4Desc: 'What you expose, machine-readable',
    },
    scanner: {
      badge: 'Check it on your own site',
      title: 'See your first AI agent visit',
      subtitle: 'Install the middleware, send a request that looks like a known AI crawler, and watch it appear in your console. Nothing is scanned from our side.',
      installTitle: 'Install the middleware',
      installDesc: 'Add the Next.js, Express or Fastify adapter and set STEALTHMARK_API_KEY in your environment.',
      testTitle: 'Send a test request',
      testDesc: 'Run the command below against your own site. The response header x-stealthmark-agent-detected: true confirms the agent was recognized.',
      seeTitle: 'Open the console',
      seeDesc: 'Each visit is listed per agent, with request counts, blocked attempts and top pages.',
      columnsTitle: 'What the console shows for each agent',
      metrics: {
        payload: 'Agent',
        tokens: 'Requests',
        waste: 'Top pages',
        waf: 'Blocked',
      },
      limits: 'Limits: StealthMark recognizes agents that identify themselves in the User-Agent or a header. It cannot see an agent that pretends to be an ordinary browser.',
      safeHarbor: 'Safe Harbor: this section does not scan, probe or contact any website. The command runs from your own terminal against your own site.',
      btnDocs: 'Read the Quickstart',
    },
    landing: LANDING_COPY.en,
    blueprint: {
      backToHome: 'Back to StealthMark',
      badge: 'Agent Policy Examples',
      title: 'Agent Policy Blueprint',
      subtitle: 'Three kinds of sites, and how each one can see its AI agent traffic and decide what agents are allowed to do.',
      withoutStealthmark: 'Without StealthMark (agent traffic is invisible)',
      withStealthmark: 'With StealthMark (you see each agent and set the policy)',
    },
  },
  es: {
    nav: {
      scanner: 'Auditor',
      platform: 'Producto',
      blueprint: 'Políticas',
      benchmark: 'Comparar',
      pricing: 'Precios',
      docs: 'Docs',
      launchConsole: 'Abrir Consola',
      tickerStatus: 'AUDITORÍA DE 60 PUNTOS ACTIVA',
      tickerDesc: 'Diagnóstico pasivo de ciberseguridad, CVE-2026-111497 (Brotli/Node2Shell), OWASP Top 10:2025 y fugas de secretos. Sin registro.',
    },
    hero: {
      pill: 'Instalación en dos líneas · Sin cambios de DNS · Misma página para humanos',
      h1Part1: 'Tu sitio web no fue creado para agentes de IA.',
      h1Part2: 'StealthMark sí.',
      desc: 'La capa de control entre tu sitio web y los agentes de IA. Identifica a los agentes de IA que se declaran como tales, define a qué pueden acceder y publica lo que ofrece tu sitio, sin cambiar la página que ven tus visitantes humanos.',
      bento1Title: 'Detectar',
      bento1Desc: 'Quién lee tu sitio',
      bento2Title: 'Observar',
      bento2Desc: 'Qué leen',
      bento3Title: 'Autorizar',
      bento3Desc: 'Qué pueden hacer',
      bento4Title: 'Manifiesto',
      bento4Desc: 'Lo que expones, legible por máquinas',
    },
    scanner: {
      badge: 'Pruébalo en tu propio sitio',
      title: 'Mira la primera visita de un agente de IA',
      subtitle: 'Instala el middleware, envía una solicitud que parezca de un crawler de IA conocido y míralo aparecer en tu consola. De nuestro lado no se escanea nada.',
      installTitle: 'Instala el middleware',
      installDesc: 'Agrega el adaptador de Next.js, Express o Fastify y define STEALTHMARK_API_KEY en tu entorno.',
      testTitle: 'Envía una solicitud de prueba',
      testDesc: 'Ejecuta el comando de abajo contra tu propio sitio. El header de respuesta x-stealthmark-agent-detected: true confirma que el agente fue reconocido.',
      seeTitle: 'Abre la consola',
      seeDesc: 'Cada visita aparece por agente, con cantidad de solicitudes, intentos bloqueados y páginas más leídas.',
      columnsTitle: 'Qué muestra la consola de cada agente',
      metrics: {
        payload: 'Agente',
        tokens: 'Solicitudes',
        waste: 'Páginas top',
        waf: 'Bloqueos',
      },
      limits: 'Límites: StealthMark reconoce a los agentes que se identifican en el User-Agent o en un header. No puede ver a un agente que se hace pasar por un navegador común.',
      safeHarbor: 'Safe Harbor: esta sección no escanea, sondea ni contacta ningún sitio web. El comando se ejecuta desde tu propia terminal contra tu propio sitio.',
      btnDocs: 'Leer la Guía Rápida',
    },
    landing: LANDING_COPY.es,
    blueprint: {
      backToHome: 'Volver a StealthMark',
      badge: 'Ejemplos de Política de Agentes',
      title: 'Blueprint de Política de Agentes',
      subtitle: 'Tres tipos de sitio y cómo cada uno puede ver su tráfico de agentes de IA y decidir qué pueden hacer.',
      withoutStealthmark: 'Sin StealthMark (el tráfico de agentes es invisible)',
      withStealthmark: 'Con StealthMark (ves a cada agente y defines la política)',
    },
  },
  pt: {
    nav: {
      scanner: 'Auditor',
      platform: 'Produto',
      blueprint: 'Políticas',
      benchmark: 'Comparar',
      pricing: 'Preços',
      docs: 'Docs',
      launchConsole: 'Abrir Console',
      tickerStatus: 'AUDITORIA DE 60 PONTOS ATIVA',
      tickerDesc: 'Diagnóstico passivo de cibersegurança, CVE-2026-111497 (Brotli/Node2Shell), OWASP Top 10:2025 e vazamentos. Sem cadastro.',
    },
    hero: {
      pill: 'Instalação em duas linhas · Sem mudança de DNS · Mesma página para humanos',
      h1Part1: 'Seu site não foi feito para agentes de IA.',
      h1Part2: 'O StealthMark foi.',
      desc: 'A camada de controle entre o seu site e os agentes de IA. Identifique os agentes de IA que se declaram como tais, defina o que eles podem acessar e publique o que o seu site oferece, sem mudar a página que seus visitantes humanos recebem.',
      bento1Title: 'Detectar',
      bento1Desc: 'Quem lê seu site',
      bento2Title: 'Observar',
      bento2Desc: 'O que eles leem',
      bento3Title: 'Autorizar',
      bento3Desc: 'O que podem fazer',
      bento4Title: 'Manifesto',
      bento4Desc: 'O que você expõe, legível por máquinas',
    },
    scanner: {
      badge: 'Teste no seu próprio site',
      title: 'Veja a primeira visita de um agente de IA',
      subtitle: 'Instale o middleware, envie uma requisição que pareça a de um crawler de IA conhecido e veja-a aparecer no seu console. Do nosso lado nada é escaneado.',
      installTitle: 'Instale o middleware',
      installDesc: 'Adicione o adaptador de Next.js, Express ou Fastify e defina STEALTHMARK_API_KEY no seu ambiente.',
      testTitle: 'Envie uma requisição de teste',
      testDesc: 'Execute o comando abaixo contra o seu próprio site. O header de resposta x-stealthmark-agent-detected: true confirma que o agente foi reconhecido.',
      seeTitle: 'Abra o console',
      seeDesc: 'Cada visita aparece por agente, com contagem de requisições, tentativas bloqueadas e páginas mais lidas.',
      columnsTitle: 'O que o console mostra de cada agente',
      metrics: {
        payload: 'Agente',
        tokens: 'Requisições',
        waste: 'Páginas top',
        waf: 'Bloqueios',
      },
      limits: 'Limites: o StealthMark reconhece agentes que se identificam no User-Agent ou em um header. Ele não enxerga um agente que se passa por um navegador comum.',
      safeHarbor: 'Safe Harbor: esta seção não escaneia, sonda nem contata nenhum site. O comando roda no seu próprio terminal contra o seu próprio site.',
      btnDocs: 'Ler o Guia Rápido',
    },
    landing: LANDING_COPY.pt,
    blueprint: {
      backToHome: 'Voltar ao StealthMark',
      badge: 'Exemplos de Política de Agentes',
      title: 'Blueprint de Política de Agentes',
      subtitle: 'Três tipos de site e como cada um pode ver seu tráfego de agentes de IA e decidir o que eles podem fazer.',
      withoutStealthmark: 'Sem StealthMark (o tráfego de agentes é invisível)',
      withStealthmark: 'Com StealthMark (você vê cada agente e define a política)',
    },
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: DICTIONARIES.en,
});

const STORAGE_KEY = 'stealthmark_lang';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
      if (stored && (stored === 'en' || stored === 'es' || stored === 'pt')) {
        setLanguageState(stored);
      }
    } catch {
      // Ignore localStorage read errors in private browsing
    }
  }, []);

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // Ignore localStorage write errors
    }
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: DICTIONARIES[language],
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
