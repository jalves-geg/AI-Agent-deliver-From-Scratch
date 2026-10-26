import type { Comparison, Lang, RegisterUnderstanding } from "./types";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function patternSentence(understanding: RegisterUnderstanding, lang: Lang): string {
  const pattern = understanding.pattern;
  if (!pattern) {
    return lang === "pt"
      ? "Não consegui ver um padrão de nome estável."
      : "I could not see a stable naming pattern.";
  }
  const sample = understanding.samples[0];
  const parts = pattern.segments.map((segment) => `${segment.role} \`${segment.sample}\``).join(", ");
  const tail = pattern.tail;
  const decoded =
    tail?.sheetType && tail.chapter && tail.serial
      ? lang === "pt"
        ? ` Cauda \`${tail.raw}\`: tipo de folha \`${tail.sheetType}\`, capítulo \`${tail.chapter}\`, série \`${tail.serial}\`.`
        : ` Tail \`${tail.raw}\`: sheet type \`${tail.sheetType}\`, chapter \`${tail.chapter}\`, serial \`${tail.serial}\`.`
      : "";
  const rev = pattern.revisionSample
    ? lang === "pt"
      ? ` Revisão \`${pattern.revisionSample}\`.`
      : ` Revision \`${pattern.revisionSample}\`.`
    : "";
  if (!sample) return `\`${pattern.expression}\`.${decoded}`;
  if (lang === "pt") {
    return `Padrão: \`${pattern.expression}\`. Exemplo \`${sample}\`: ${parts}.${decoded}${rev}`;
  }
  return `Naming pattern: \`${pattern.expression}\`. Example \`${sample}\`: ${parts}.${decoded}${rev}`;
}

export function explainUnderstanding(understanding: RegisterUnderstanding, lang: Lang): string {
  const sheetLines = understanding.sheets.map((sheet) => {
    const role =
      sheet.role === "codes"
        ? lang === "pt"
          ? "listas de códigos"
          : "code lists"
        : sheet.role === "register"
          ? lang === "pt"
            ? "entregáveis"
            : "deliverables"
          : lang === "pt"
            ? "outra"
            : "other";
    return `\`${sheet.name}\` — ${role} (${sheet.rows} ${lang === "pt" ? "linhas" : "rows"})`;
  });
  const codeNames = understanding.codes.map((section) => section.category);
  const codesLine =
    codeNames.length === 0
      ? lang === "pt"
        ? "Não encontrei uma folha de códigos com pares nome/código."
        : "I did not find a codes sheet of name/code pairs."
      : lang === "pt"
        ? `Códigos lidos: ${codeNames.join(", ")}.`
        : `Codes read: ${codeNames.join(", ")}.`;

  const header =
    understanding.headerRow == null
      ? lang === "pt"
        ? "Linha de cabeçalho: não se aplica (leitura de texto)."
        : "Header row: not applicable (read from text)."
      : lang === "pt"
        ? `Linha de cabeçalho: ${understanding.headerRow}`
        : `Header row: ${understanding.headerRow}`;
  const column =
    understanding.numberColumn == null
      ? lang === "pt"
        ? "Coluna dos números: não identificada"
        : "Document-number column: not identified"
      : lang === "pt"
        ? `Coluna dos números / nomes: ${understanding.numberColumn}`
        : `Document-number column: ${understanding.numberColumn}`;
  const count =
    lang === "pt"
      ? `Entregáveis: ${understanding.deliverableCount}`
      : `Deliverables: ${understanding.deliverableCount}`;
  const skipped =
    understanding.skippedHeadingCount > 0
      ? lang === "pt"
        ? `Ignorei ${understanding.skippedHeadingCount} linhas de secção, por exemplo ${understanding.skippedHeadings
            .slice(0, 3)
            .map((item) => `\`${item}\``)
            .join(", ")}.`
        : `I skipped ${understanding.skippedHeadingCount} section rows, for example ${understanding.skippedHeadings
            .slice(0, 3)
            .map((item) => `\`${item}\``)
            .join(", ")}.`
      : "";
  const warnings = understanding.warnings.filter((warning) => !warning.startsWith(`${understanding.skippedHeadingCount} section`));
  const warningBlock =
    warnings.length > 0
      ? `\n\n${lang === "pt" ? "Avisos" : "Notes"}\n${list(warnings)}`
      : "";

  if (lang === "pt") {
    return [
      `Li \`${understanding.fileName}\`.`,
      "",
      "**Folhas**",
      list(sheetLines),
      "",
      codesLine,
      "",
      "**O que vou usar**",
      list([
        understanding.registerSheet
          ? `Folha do registo: ${understanding.registerSheet}`
          : "Folha do registo: não encontrada",
        header,
        column,
        count,
      ]),
      "",
      patternSentence(understanding, lang),
      skipped,
      "Está certo? Confirma, ou diz a folha, a linha de cabeçalho ou a coluna que devo usar.",
    ]
      .filter((part) => part !== "")
      .join("\n") + warningBlock;
  }

  return [
    `I read \`${understanding.fileName}\`.`,
    "",
    "**Sheets**",
    list(sheetLines),
    "",
    codesLine,
    "",
    "**What I will use**",
    list([
      understanding.registerSheet ? `Register sheet: ${understanding.registerSheet}` : "Register sheet: not found",
      header,
      column,
      count,
    ]),
    "",
    patternSentence(understanding, lang),
    skipped,
    "Is that right? Confirm it, or tell me the sheet, the header row, or the column to use.",
  ]
    .filter((part) => part !== "")
    .join("\n") + warningBlock;
}

export function explainComparison(comparison: Comparison, lang: Lang): string {
  const issues = comparison.rows.filter((row) => row.status !== "ok");
  const lines = issues.slice(0, 12).map((row) => {
    if (row.status === "wrong_revision") {
      const found = row.foundFiles[0] ?? "—";
      return lang === "pt"
        ? `\`${row.deliverable}\` — esperada \`${row.expectedRevision ?? "—"}\`, encontrada \`${row.foundRevision ?? "—"}\` em \`${found}\``
        : `\`${row.deliverable}\` — expected \`${row.expectedRevision ?? "—"}\`, found \`${row.foundRevision ?? "—"}\` in \`${found}\``;
    }
    if (row.status === "missing") {
      return lang === "pt" ? `Em falta: \`${row.deliverable}\`` : `Missing: \`${row.deliverable}\``;
    }
    return lang === "pt"
      ? `A mais: \`${row.foundFiles[0] ?? "—"}\``
      : `Extra: \`${row.foundFiles[0] ?? "—"}\``;
  });
  const more =
    issues.length > lines.length
      ? lang === "pt"
        ? `\n- … e mais ${issues.length - lines.length} na tabela.`
        : `\n- … and ${issues.length - lines.length} more in the table.`
      : "";
  const unconfirmed =
    comparison.confirmed
      ? ""
      : lang === "pt"
        ? "\n\nO entendimento do registo ainda não estava confirmado. Usei a leitura actual. Diz se quiseres corrigir a folha, a linha ou a coluna."
        : "\n\nThe register understanding was not confirmed yet. I used the current reading. Say if you want the sheet, header row, or column changed.";

  if (lang === "pt") {
    return [
      `Conferi ${comparison.expected} entregáveis com ${comparison.folderFiles} ficheiros (extensões ignoradas).`,
      "",
      list([
        `Encontrados, revisão certa: ${comparison.ok}`,
        `Revisão diferente: ${comparison.wrongRevision}`,
        `Em falta: ${comparison.missing}`,
        `Ficheiros a mais: ${comparison.extra}`,
      ]),
      lines.length ? `\n**Diferenças**\n${lines.map((line) => `- ${line}`).join("\n")}${more}` : "\nNenhuma diferença.",
      "\nA tabela tem o resultado completo. Podes exportar para Excel ou CSV.",
    ].join("\n") + unconfirmed;
  }

  return [
    `Checked ${comparison.expected} deliverables against ${comparison.folderFiles} files (extensions ignored).`,
    "",
    list([
      `Found, correct revision: ${comparison.ok}`,
      `Wrong revision: ${comparison.wrongRevision}`,
      `Missing: ${comparison.missing}`,
      `Extra files: ${comparison.extra}`,
    ]),
    lines.length ? `\n**Differences**\n${lines.map((line) => `- ${line}`).join("\n")}${more}` : "\nNo differences.",
    "\nThe table has the full result. You can export it to Excel or CSV.",
  ].join("\n") + unconfirmed;
}

export function explainConfirmed(hasFolder: boolean, lang: Lang): string {
  if (lang === "pt") {
    return hasFolder
      ? "Entendimento confirmado. Vou conferir a pasta que já está na sessão."
      : "Entendimento confirmado e guardado nesta sessão. Envia a pasta, ou cola a lista de nomes, quando quiseres a conferência.";
  }
  return hasFolder
    ? "Understanding confirmed. I will check the folder already in this session."
    : "Understanding confirmed and kept for this session. Share a folder, or paste the filenames, when you want the check.";
}

export function explainNeedConfirm(lang: Lang): string {
  return lang === "pt"
    ? "Guardei os nomes da pasta. Confirma primeiro o entendimento do registo (ou diz para conferir mesmo assim) e eu faço a comparação."
    : "I stored the folder names. Confirm the register understanding first (or tell me to check anyway) and I will run the comparison.";
}

export function explainHelp(lang: Lang): string {
  return lang === "pt"
    ? "Envia o registo de entregáveis (Excel, CSV ou PDF). Eu digo o que entendi — folhas, linha de cabeçalho, coluna dos números, padrão do nome e quantidade — e espero a tua confirmação. Depois envia uma pasta ou cola os nomes dos ficheiros."
    : "Send the deliverables register (Excel, CSV, or PDF). I will tell you what I understood — sheets, header row, document-number column, naming pattern, and how many deliverables — and wait for you to confirm. Then share a folder or paste the filenames.";
}
