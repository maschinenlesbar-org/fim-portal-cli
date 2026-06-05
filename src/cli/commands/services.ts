import { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  addPagination,
  assertEnum,
  choiceOption,
  collect,
  collectFreigabeStatus,
  pruneUndefined,
  renderJson,
  renderRaw,
} from "../shared.js";
import type {
  LeistungSteckbriefSearchParams,
  LeistungStammtextSearchParams,
} from "../../client/params.js";
import {
  LeistungSucheInValues,
  LeistungSteckbriefSearchOrderValues,
  LeistungStammtextSearchOrderValues,
  SpracheValues,
  BehoerdeValues,
  XzufiSourceValues,
} from "../../client/enums.js";

export function registerServiceCommands(program: Command, deps: CliDeps): void {
  registerServiceProfiles(program, deps);
  registerServiceTexts(program, deps);
}

function registerServiceProfiles(program: Command, deps: CliDeps): void {
  const sp = program
    .command("service-profiles")
    .description("Leistungsteckbriefe (XZuFi service descriptions)");

  const search = sp
    .command("search")
    .description("Search/filter Leistungsteckbriefe")
    .option("--leistungstyp <typ>", "filter by Leistungstyp (repeatable)", collect)
    .option("--typisierung <t>", "filter by Typisierung (repeatable)", collect)
    .option("--fts-query <q>", "full-text search query")
    .addOption(choiceOption("--suche-nur-in <module>", "restrict full-text search", LeistungSucheInValues))
    .option("--title <text>", "filter by title")
    .option("--leistungsbezeichnung <text>", "filter by Leistungsbezeichnung")
    .option("--leistungsbezeichnung2 <text>", "filter by Leistungsbezeichnung II")
    .option("--leistungsschluessel <key>", "filter by Leistungsschluessel")
    .option("--rechtsgrundlagen <text>", "filter by Rechtsgrundlagen")
    .option(
      "--freigabe-status <code>",
      "filter by Freigabestatus 1..8 (repeatable)",
      collectFreigabeStatus,
    )
    .option("--einheitlicher-ansprechpartner", "only services with Einheitlicher Ansprechpartner")
    .option("--updated-since <iso>", "filter by last-update timestamp (ISO-8601)")
    .option("--sdg <code>", "filter by SDG information area (repeatable)", collect)
    .option("--sdg-relevant", "only SDG-relevant services")
    .addOption(choiceOption("--sprache <lang>", "filter by language", SpracheValues))
    .option("--leistungsadressat <code>", "filter by Leistungsadressat (repeatable)", collect)
    .option("--ozg-themenfeld <field>", "filter by OZG Themenfeld (repeatable)", collect)
    .option("--ozg-id <id>", "filter by OZG id")
    .addOption(choiceOption("--vollzugsbehoerde <code>", "filter by Vollzugsbehoerde", BehoerdeValues))
    .option("--lagen-portalverbund <text>", "filter by Lagen (Portalverbund)")
    .addOption(
      choiceOption("--order-by <order>", "result order", LeistungSteckbriefSearchOrderValues),
    );
  addPagination(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = pruneUndefined({
        leistungstyp: opts["leistungstyp"],
        typisierung: opts["typisierung"],
        fts_query: opts["ftsQuery"],
        suche_nur_in: opts["sucheNurIn"],
        title: opts["title"],
        leistungsbezeichnung: opts["leistungsbezeichnung"],
        leistungsbezeichnung2: opts["leistungsbezeichnung2"],
        leistungsschluessel: opts["leistungsschluessel"],
        rechtsgrundlagen: opts["rechtsgrundlagen"],
        freigabe_status: opts["freigabeStatus"],
        einheitlicher_ansprechpartner: opts["einheitlicherAnsprechpartner"],
        updated_since: opts["updatedSince"],
        lagen_portalverbund: opts["lagenPortalverbund"],
        sdg: opts["sdg"],
        sdg_relevant: opts["sdgRelevant"],
        sprache: opts["sprache"],
        leistungsadressat: opts["leistungsadressat"],
        ozg_themenfeld: opts["ozgThemenfeld"],
        ozg_id: opts["ozgId"],
        vollzugsbehoerde: opts["vollzugsbehoerde"],
        order_by: opts["orderBy"],
        offset: opts["offset"],
        limit: opts["limit"],
      }) as LeistungSteckbriefSearchParams;
      renderJson(deps, global, await client.serviceProfiles.search(params));
    }),
  );

  sp.command("get <leistungsschluessel>")
    .description("Get a single Leistungsteckbrief")
    .action(
      action(deps, async ({ client, global }, [key]) => {
        renderJson(deps, global, await client.serviceProfiles.get(key!));
      }),
    );

  sp.command("xzufi <leistungsschluessel>")
    .description("Download the XZuFi XML for a Leistungsteckbrief")
    .action(
      action(deps, async ({ client, global }, [key]) => {
        renderRaw(deps, global, await client.serviceProfiles.downloadXzufi(key!));
      }),
    );

  sp.command("pdf <leistungsschluessel> <languageCode>")
    .description("Export a Leistungsteckbrief as PDF")
    .action(
      action(deps, async ({ client, global }, [key, lang]) => {
        renderRaw(deps, global, await client.serviceProfiles.exportPdf(key!, lang!));
      }),
    );
}

function registerServiceTexts(program: Command, deps: CliDeps): void {
  const st = program
    .command("service-texts")
    .description("Leistungsstammtexte (XZuFi service master texts)");

  const search = st
    .command("search")
    .description("Search/filter Leistungsstammtexte")
    .option("--leistungsschluessel <key>", "filter by Leistungsschluessel")
    .option("--redaktion-id <id>", "filter by Redaktion id")
    .option("--title <text>", "filter by title")
    .option("--leistungsbezeichnung <text>", "filter by Leistungsbezeichnung")
    .option("--leistungsbezeichnung2 <text>", "filter by Leistungsbezeichnung II")
    .option("--rechtsgrundlagen <text>", "filter by Rechtsgrundlagen")
    .option("--leistungstyp <typ>", "filter by Leistungstyp (repeatable)", collect)
    .option("--typisierung <t>", "filter by Typisierung (repeatable)", collect)
    .option("--updated-since <iso>", "filter by last-update timestamp (ISO-8601)")
    .option("--leistungsadressat <code>", "filter by Leistungsadressat (repeatable)", collect)
    .option("--ozg-themenfeld <field>", "filter by OZG Themenfeld (repeatable)", collect)
    .option("--ozg-id <id>", "filter by OZG id")
    .addOption(choiceOption("--vollzugsbehoerde <code>", "filter by Vollzugsbehoerde", BehoerdeValues))
    .option("--einheitlicher-ansprechpartner", "only services with Einheitlicher Ansprechpartner")
    .addOption(choiceOption("--source <src>", "filter by XZuFi source", XzufiSourceValues))
    .option("--fts-query <q>", "full-text search query")
    .addOption(choiceOption("--suche-nur-in <module>", "restrict full-text search", LeistungSucheInValues))
    .option("--lagen-portalverbund <text>", "filter by Lagen (Portalverbund)")
    .addOption(
      choiceOption("--order-by <order>", "result order", LeistungStammtextSearchOrderValues),
    );
  addPagination(search).action(
    action(deps, async ({ client, global, opts }) => {
      const params = pruneUndefined({
        leistungsschluessel: opts["leistungsschluessel"],
        redaktion_id: opts["redaktionId"],
        title: opts["title"],
        leistungsbezeichnung: opts["leistungsbezeichnung"],
        leistungsbezeichnung2: opts["leistungsbezeichnung2"],
        rechtsgrundlagen: opts["rechtsgrundlagen"],
        leistungstyp: opts["leistungstyp"],
        typisierung: opts["typisierung"],
        updated_since: opts["updatedSince"],
        lagen_portalverbund: opts["lagenPortalverbund"],
        leistungsadressat: opts["leistungsadressat"],
        ozg_themenfeld: opts["ozgThemenfeld"],
        ozg_id: opts["ozgId"],
        vollzugsbehoerde: opts["vollzugsbehoerde"],
        einheitlicher_ansprechpartner: opts["einheitlicherAnsprechpartner"],
        source: opts["source"],
        fts_query: opts["ftsQuery"],
        suche_nur_in: opts["sucheNurIn"],
        order_by: opts["orderBy"],
        offset: opts["offset"],
        limit: opts["limit"],
      }) as LeistungStammtextSearchParams;
      renderJson(deps, global, await client.serviceTexts.search(params));
    }),
  );

  st.command("get <redaktionId> <leistungId> <source>")
    .description("Get a single Leistungsstammtext (source: leika|landesredaktion|pvog)")
    .action(
      action(deps, async ({ client, global }, [redaktionId, leistungId, source]) => {
        const src = assertEnum(source!, XzufiSourceValues, "source");
        renderJson(deps, global, await client.serviceTexts.get(redaktionId!, leistungId!, src));
      }),
    );

  st.command("xzufi <redaktionId> <leistungId> <source>")
    .description("Download the XZuFi XML for a Leistungsstammtext")
    .action(
      action(deps, async ({ client, global }, [redaktionId, leistungId, source]) => {
        const src = assertEnum(source!, XzufiSourceValues, "source");
        renderRaw(deps, global, await client.serviceTexts.downloadXzufi(redaktionId!, leistungId!, src));
      }),
    );

  st.command("pdf <redaktionId> <leistungId> <source> <languageCode>")
    .description("Export a Leistungsstammtext as PDF")
    .action(
      action(deps, async ({ client, global }, [redaktionId, leistungId, source, lang]) => {
        const src = assertEnum(source!, XzufiSourceValues, "source");
        renderRaw(
          deps,
          global,
          await client.serviceTexts.exportPdf(redaktionId!, leistungId!, src, lang!),
        );
      }),
    );

  st.command("parsed-xzufi <redaktionId> <leistungId> <source>")
    .description("Get the parsed XZuFi JSON (INSTABLE per API docs)")
    .action(
      action(deps, async ({ client, global }, [redaktionId, leistungId, source]) => {
        const src = assertEnum(source!, XzufiSourceValues, "source");
        renderJson(deps, global, await client.serviceTexts.parsedXzufi(redaktionId!, leistungId!, src));
      }),
    );
}
