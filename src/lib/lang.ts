import type { Lang } from "./types";

const PT =
  /\b(não|nao|sim|planilha|arquivo|arquivos|ficheiro|ficheiros|entregáveis|entregaveis|entregável|coluna|cabeçalho|cabecalho|folha|pasta|confirma|confirmo|número|numero|desenho|desenhos|lista|está|esta|estão|estao|revisão|revisao|correto|correta|linha|folhas|consegues|consegue|podes|verificar|verifica|verificação|verificacao|conferir|confere|direitos|falta|faltam|registo)\b/gi;

const EN =
  /\b(the|sheet|column|header|folder|please|deliverable|deliverables|register|yes|missing|revision|check|that's|thats)\b/gi;

export function detectLang(text: string, fallback: Lang = "en"): Lang {
  const pt = text.match(PT)?.length ?? 0;
  const en = text.match(EN)?.length ?? 0;
  if (pt === 0 && en === 0) return fallback;
  return pt > en ? "pt" : "en";
}
