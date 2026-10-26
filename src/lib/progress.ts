import type { Lang } from "./types";

export function progressText(step: "parse" | "folder" | "compare" | "model", lang: Lang): string {
  if (lang === "pt") {
    if (step === "parse") return "A ler o registo…";
    if (step === "folder") return "A guardar os nomes da pasta…";
    if (step === "compare") return "A comparar os ficheiros…";
    return "A escrever a resposta…";
  }
  if (step === "parse") return "Reading the register…";
  if (step === "folder") return "Storing folder names…";
  if (step === "compare") return "Comparing filenames…";
  return "Writing the reply…";
}

export function modelFailureText(message: string, lang: Lang): string {
  if (lang === "pt") {
    return `O modelo falhou (${message}). A leitura determinística continua no painel e, se a comparação correu, na tabela.`;
  }
  return `The model failed (${message}). The deterministic reading is still in the context panel and, if the check ran, in the table.`;
}
