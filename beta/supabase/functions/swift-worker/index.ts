import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let supabase: any = null;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "sync_vmgc";
    const enrollmentNumber = String(body.enrollmentNumber || "").trim();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const AAG_CRON_SECRET = Deno.env.get("AAG_CRON_SECRET") || "";

    const AAG_USER = Deno.env.get("AAG_USER")!;
    const AAG_API_KEY = Deno.env.get("AAG_API_KEY")!;
    const VMGC_OPTION_CLUB_ID = Number(Deno.env.get("VMGC_OPTION_CLUB_ID")!);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
    const AAG_ALERT_EMAIL_TO = Deno.env.get("AAG_ALERT_EMAIL_TO") || "";
    const AAG_ALERT_EMAIL_FROM = Deno.env.get("AAG_ALERT_EMAIL_FROM") || "";

    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // La automatización solamente puede ejecutar auto_export_aag y debe
    // presentar el secreto compartido guardado en Vault y Edge Secrets.
    const requestCronSecret = req.headers.get("x-cron-secret") || "";
    const isAuthorizedCron =
      ["auto_export_aag", "refresh_all_exports"].includes(action) &&
      AAG_CRON_SECRET.length >= 32 &&
      requestCronSecret === AAG_CRON_SECRET;

    // Toda llamada que no provenga del cron debe pertenecer a un
    // administrador activo. La validación se hace nuevamente en el servidor;
    // no se confía solamente en el control visual de los HTML.
    if (!isAuthorizedCron) {
      const authorization = req.headers.get("authorization") || "";
      const accessToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : "";

      if (!accessToken) {
        return new Response(
          JSON.stringify({ ok: false, error: "Falta autenticación" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const { data: userData, error: userError } =
        await supabase.auth.getUser(accessToken);

      if (userError || !userData?.user) {
        return new Response(
          JSON.stringify({ ok: false, error: "Sesión inválida o vencida" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, active")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (
        profileError ||
        !profile ||
        profile.active !== true ||
        profile.role !== "admin"
      ) {
        return new Response(
          JSON.stringify({ ok: false, error: "Acceso reservado a administradores" }),
          {
            status: 403,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    const auth = btoa(`${AAG_USER}:${AAG_API_KEY}`);

    // URLs AAG PRODUCCIÓN
    const AAG_BASE = "https://servicesapiaag-prod.azurewebsites.net/api/supplier";
    const AAG_V2_BASE = "https://servicesapiaag-prod.azurewebsites.net/api/v2/supplier";

    // AAG conserva las versiones de una tarjeta corregida (por ejemplo,
    // "Ajuste" y "Ajustada") dentro de ScoreCards. Para el seguimiento se
    // cuenta una tarjeta efectiva por matrícula, no cada versión histórica.
    function countEffectiveRemoteScorecards(scoreCards: any): number | null {
      if (!Array.isArray(scoreCards)) return null;
      const effective = new Set<string>();
      scoreCards.forEach((card: any, index: number) => {
        const enrollment = String(
          card?.EnrollmentNumber ?? card?.enrollmentNumber ?? ""
        ).trim();
        const id = String(card?.Id ?? card?.id ?? "").trim();
        effective.add(enrollment ? `enrollment:${enrollment}` : id ? `id:${id}` : `row:${index}`);
      });
      return effective.size;
    }

    async function sendAagAlertEmail(subject: string, html: string) {
      if (!RESEND_API_KEY || !AAG_ALERT_EMAIL_TO || !AAG_ALERT_EMAIL_FROM) {
        console.log("Resend no configurado. No se envía email AAG.");
        return;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: AAG_ALERT_EMAIL_FROM,
          to: [AAG_ALERT_EMAIL_TO],
          subject,
          html
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("Error enviando email Resend:", txt);
      }
    }

    function normalizarFechaISO(fecha: string) {
      if (!fecha) return new Date().toISOString();
      return new Date(fecha + "T09:00:00-03:00").toISOString();
    }

    function normalizarBornDate(value: any) {
      const s = String(value || "").trim();
      if (!s) return null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

      const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
      if (m) {
        const dd = m[1].padStart(2, "0");
        const mm = m[2].padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }

      return null;
    }

    function holeValue(holeScores: any, n: number) {
      if (!holeScores) return null;

      const h = holeScores[n] || holeScores[String(n)];
      if (!h) return null;

      if (typeof h === "object") {
        return h.strokes ?? null;
      }

      return h;
    }

    function normalizarTextoAAG(value: any) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    }

    function claveNombreTeeAAG(value: any) {
      const ignoradas = new Set([
        "dama", "damas", "mujer", "mujeres", "female", "femenino", "femenina",
        "caballero", "caballeros", "hombre", "hombres", "male", "masculino", "masculina"
      ]);

      return normalizarTextoAAG(value)
        .split(" ")
        .filter(Boolean)
        .filter(p => !ignoradas.has(p))
        .map(p => {
          if (p.length > 4 && p.endsWith("es")) p = p.slice(0, -2);
          else if (p.length > 3 && p.endsWith("s")) p = p.slice(0, -1);
          if (p.length > 4 && (p.endsWith("a") || p.endsWith("o"))) p = p.slice(0, -1);
          return p;
        })
        .filter(Boolean)
        .join(" ");
    }

    function categoriaDeScorecard(sc: any, categorias: any[]) {
      const id = String(sc?.category_id || "").trim();
      if (!id) return null;
      return categorias.find(c => String(c?.id || "").trim() === id) || null;
    }

    function reglaTeeDeScorecard(sc: any, categorias: any[]) {
      const categoria = categoriaDeScorecard(sc, categorias);
      const reglas = Array.isArray(categoria?.tee_rules) ? categoria.tee_rules : [];
      if (!reglas.length) return null;

      const playingTeeId = String(categoria?.playing_tee_aag_teeout_id || "").trim();
      if (playingTeeId) {
        const regla = reglas.find((r: any) =>
          String(r?.aag_teeout_id || "").trim() === playingTeeId
        );
        if (regla) return regla;
      }

      const teeId = String(sc?.tee_id || "").trim();
      if (teeId) {
        const regla = reglas.find((r: any) =>
          String(r?.aag_teeout_id || "").trim() === teeId
        );
        if (regla) return regla;
      }

      const nombre = normalizarTextoAAG(sc?.tee_name);
      if (nombre) {
        const regla = reglas.find((r: any) =>
          normalizarTextoAAG(r?.reference?.tee_name) === nombre
        );
        if (regla) return regla;
      }

      return reglas.length === 1 ? reglas[0] : null;
    }

    function resolverTeeVigenteAAG(sc: any, categorias: any[], teesAAG: any[]) {
      const regla = reglaTeeDeScorecard(sc, categorias);
      if (!regla) {
        return { tee: null, regla: null, metodo: "sin_regla_v2", candidatas: 0 };
      }

      const teeId = String(sc?.tee_id || "").trim();
      if (teeId) {
        const tee = teesAAG.find(t => String(t?.id || "").trim() === teeId);
        if (tee) return { tee, regla, metodo: "uuid_actual", candidatas: 1 };
      }

      const referencia = regla?.reference || {};
      const nombreAsignado = referencia.tee_name || sc?.tee_name || "";
      const clave = claveNombreTeeAAG(nombreAsignado);
      let candidatas = teesAAG.filter(t => claveNombreTeeAAG(t?.tee_name) === clave);

      if (candidatas.length === 1) {
        return { tee: candidatas[0], regla, metodo: "nombre_unico", candidatas: 1 };
      }

      const categoriaRef = referencia?.category != null && referencia.category !== ""
        ? Number(referencia.category)
        : null;
      const genero = normalizarTextoAAG(sc?.player_gender);
      const categoriaJugador = ["female", "f", "dama", "damas", "mujer", "femenino", "femenina"].includes(genero)
        ? 1
        : ["male", "m", "caballero", "caballeros", "hombre", "masculino", "masculina"].includes(genero)
          ? 0
          : null;
      const categoriaObjetivo = Number.isFinite(categoriaRef) ? categoriaRef : categoriaJugador;

      if (categoriaObjetivo != null) {
        const porCategoria = candidatas.filter(t => Number(t?.category) === categoriaObjetivo);
        if (porCategoria.length === 1) {
          return { tee: porCategoria[0], regla, metodo: "nombre_categoria", candidatas: candidatas.length };
        }
        if (porCategoria.length > 1) candidatas = porCategoria;
      }

      const fieldRef = referencia?.aag_field_id != null && referencia.aag_field_id !== ""
        ? Number(referencia.aag_field_id)
        : null;
      if (Number.isFinite(fieldRef)) {
        const porField = candidatas.filter(t => Number(t?.aag_field_id) === fieldRef);
        if (porField.length === 1) {
          return { tee: porField[0], regla, metodo: "nombre_categoria_field", candidatas: candidatas.length };
        }
      }

      return {
        tee: null,
        regla,
        metodo: candidatas.length ? "ambiguo" : "sin_coincidencia",
        candidatas: candidatas.length,
        opciones: candidatas.map(t => ({
          aag_teeout_id: t.aag_teeout_id,
          aag_field_id: t.aag_field_id,
          tee_name: t.tee_name,
          category: t.category
        }))
      };
    }

    async function generarAagPayloadsDesdeTorneoWorker(tournamentId: string) {
      const { data: torneo, error: torneoError } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", tournamentId)
        .eq("data_schema_version", 2)
        .single();

      if (torneoError || !torneo) {
        throw new Error("No se encontró torneo para generar AAG.");
      }

      const { data: scorecards, error: scError } = await supabase
        .from("scorecards")
        .select("*")
        .eq("tournament_id", tournamentId)
        .eq("export_ready", true)
        .eq("aag_exportable", true);

      if (scError) throw scError;

      if (!scorecards?.length) {
        return [];
      }

      const { data: categorias, error: categoriasError } = await supabase
        .from("tournament_categories")
        .select("id, category_system, tee_rules, playing_tee_aag_teeout_id, hole_segment")
        .eq("tournament_id", tournamentId);

      if (categoriasError) throw categoriasError;
      if ((categorias || []).some((c: any) => c.category_system !== "new")) {
        throw new Error("El torneo contiene categorías que no pertenecen al sistema v2.");
      }

      const { data: teesAAG, error: teesError } = await supabase
        .from("aag_teeouts")
        .select("id, aag_teeout_id, aag_field_id, tee_name, category");

      if (teesError) throw teesError;

      const grupos = new Map<string, { tee: any; scorecards: any[] }>();

      for (const sc of scorecards) {
        if (!sc.aag_member_number || !sc.hole_scores) continue;

        let jugables = 0;

        for (let i = 1; i <= 18; i++) {
          const golpes = holeValue(sc.hole_scores, i);

          if (
            golpes !== null &&
            golpes !== undefined &&
            Number(golpes) > 0
          ) {
            jugables++;
          }
        }

        const hoyosTorneo = Number(torneo.hole_count || 18);

        if (hoyosTorneo === 18 && jugables < 18) continue;
        if (hoyosTorneo === 9 && jugables < 9) continue;

        const resolucion = resolverTeeVigenteAAG(sc, categorias || [], teesAAG || []);
        if (!resolucion.tee) {
          throw new Error(
            `No se pudo resolver el tee AAG vigente para ${sc.display_name || "SIN NOMBRE"} ` +
            `(${sc.tee_name || "SIN TEE"}). Método: ${resolucion.metodo}.`
          );
        }

        const tee = resolucion.tee;
        const key = [tee.id, tee.aag_field_id, tee.aag_teeout_id, tee.category].join("|");
        if (!grupos.has(key)) grupos.set(key, { tee, scorecards: [] });
        grupos.get(key)!.scorecards.push(sc);
      }

      const payloads = [];

      for (const grupoInfo of grupos.values()) {
        const grupo = grupoInfo.scorecards;
        const teeMatch = grupoInfo.tee;
        const ejemplo = grupo[0];

        const scoreCards = grupo.map((sc: any) => {
          const hoyosConScore = [];

          for (let i = 1; i <= 18; i++) {
            const golpes = holeValue(sc.hole_scores, i);

            if (
              golpes !== null &&
              golpes !== undefined &&
              Number(golpes) > 0
            ) {
              hoyosConScore.push(i);
            }
          }

          const tiene1a9 = hoyosConScore.some(h => h >= 1 && h <= 9);
          const tiene10a18 = hoyosConScore.some(h => h >= 10 && h <= 18);

          let iniHole = 1;

          if (!tiene1a9 && tiene10a18) {
            iniHole = 10;
          }

          const card: any = {
            EnrollmentNumber: String(sc.aag_member_number),
            BatchNumber: 1,
            IniHole: iniHole
          };

          for (let i = 1; i <= 18; i++) {
            card[`ScoreGrossHole${String(i).padStart(2, "0")}`] =
              holeValue(sc.hole_scores, i);
          }

          card.ScoreGrossTotal = null;
          card.ScoreGrossIda = null;
          card.ScoreGrossVta = null;

          return card;
        });

        payloads.push({
          payload: {
            Title: torneo.name,
            SubTitle: "Resultados oficiales",
            GameMode: 1,
            BatchesHoles: Number(torneo.hole_count || 18),
            BatchesCount: 1,
            StartDate: normalizarFechaISO(torneo.tournament_date),

            Field: Number(teeMatch.aag_field_id),
            TeeOut: Number(teeMatch.aag_teeout_id),
            Category: Number(teeMatch.category),
            EndHandicap: 54,
            Active: true,
            InitialHole: 1,

            ScoreCards: scoreCards
          },

          meta: {
            tee_name: ejemplo.tee_name,
            gender: ejemplo.player_gender,
            aag_teeout_id: teeMatch.aag_teeout_id,
            aag_field_id: teeMatch.aag_field_id
          }
        });
      }

      return payloads;
    }

    if (action === "test_email") {

      await sendAagAlertEmail(
        "Prueba AAG VMGC",
        `
      <h2>Prueba de notificaciones AAG</h2>
      <p>Si recibiste este correo, Resend quedó configurado correctamente.</p>
      <p>Fecha: ${new Date().toISOString()}</p>
    `
      );

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Mail enviado"
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (action === "auto_export_aag") {
      const dryRun = body.dry_run === true;

      if (!dryRun) {

        await sendAagAlertEmail(
          "🚀 Inicio exportación automática AAG",
          `
      <h2>Inicio exportación automática AAG</h2>

      <p>
        El proceso automático semanal comenzó correctamente.
      </p>

      <p>
        Fecha:
        <strong>${new Date().toLocaleString("es-AR")}</strong>
      </p>
    `
        );

      }

      const runLog: any[] = [];
      let tournamentsFound = 0;
      let exportsSent = 0;
      let exportsOk = 0;
      let exportsPartial = 0;
      let exportsError = 0;

      const { data: run, error: runError } = await supabase
        .from("aag_export_runs")
        .insert({
          status: "running",
          dry_run: dryRun
        })
        .select("id")
        .single();

      if (runError) throw runError;

      const runId = run.id;

      try {
        const { data: tournaments, error: torneosError } = await supabase
          .from("tournaments")
          .select(`
          id,
          name,
          tournament_date,
          status,
          data_schema_version,
          aag_export_excluded,
          game_modes ( name )
        `)
          .in("status", ["archived", "open", "officialized"])
          .eq("data_schema_version", 2)
          .eq("aag_export_excluded", false)
          .order("tournament_date", { ascending: false });

        if (torneosError) throw torneosError;

        for (const torneo of tournaments || []) {
          const tournamentId = torneo.id;

          const modalidad = normalizarTextoAAG(torneo.game_modes?.name);

          if (!modalidad.includes("medal")) {

            runLog.push({
              tournament_id: tournamentId,
              tournament: torneo.name,
              action: "skip",
              reason: `Modalidad no exportable a AAG: ${torneo.game_modes?.name || "sin modalidad"}`
            });

            continue;
          }

          const { count: scorecardsCount, error: scCountError } = await supabase
            .from("scorecards")
            .select("id", { count: "exact", head: true })
            .eq("tournament_id", tournamentId)
            .eq("export_ready", true)
            .eq("aag_exportable", true);

          if (scCountError) throw scCountError;

          if (!scorecardsCount || scorecardsCount <= 0) {
            runLog.push({
              tournament_id: tournamentId,
              tournament: torneo.name,
              action: "skip",
              reason: "Sin scorecards export_ready"
            });
            continue;
          }

          // Antes de preparar cualquier archivo AAG, todo torneo terminado
          // que siga abierto u oficializado debe quedar archivado.
          if (["open", "officialized"].includes(torneo.status)) {
            if (dryRun) {
              runLog.push({
                tournament_id: tournamentId,
                tournament: torneo.name,
                action: "would_archive",
                previous_status: torneo.status,
                reason: "Tiene scorecards export_ready"
              });
            } else {
              const estadoAnterior = torneo.status;

              const { data: torneoArchivado, error: archiveError } = await supabase
                .from("tournaments")
                .update({ status: "archived" })
                .eq("id", tournamentId)
                .in("status", ["open", "officialized"])
                .select("id, status")
                .maybeSingle();

              if (archiveError) throw archiveError;

              if (!torneoArchivado || torneoArchivado.status !== "archived") {
                runLog.push({
                  tournament_id: tournamentId,
                  tournament: torneo.name,
                  action: "skip",
                  reason: "No se pudo confirmar el archivado previo a la exportación"
                });
                continue;
              }

              torneo.status = "archived";

              runLog.push({
                tournament_id: tournamentId,
                tournament: torneo.name,
                action: "archived",
                previous_status: estadoAnterior,
                scorecards_export_ready: scorecardsCount
              });
            }
          }

          const { data: existingExports, error: existingError } = await supabase
            .from("aag_exports")
            .select("id, status, aag_tournament_id, aag_remote_status")
            .eq("tournament_id", tournamentId)
            .eq("is_current", true);

          if (existingError) throw existingError;

          const alreadySent = (existingExports || []).some((e: any) =>
            e.status === "sent" ||
            !!e.aag_tournament_id ||
            ["Abierto", "Procesado"].includes(e.aag_remote_status)
          );

          if (alreadySent) {
            runLog.push({
              tournament_id: tournamentId,
              tournament: torneo.name,
              action: "skip",
              reason: "Ya tiene export AAG enviado o con ID AAG"
            });
            continue;
          }

          tournamentsFound++;

          runLog.push({
            tournament_id: tournamentId,
            tournament: torneo.name,
            action: dryRun ? "would_export" : "export",
            scorecards_export_ready: scorecardsCount
          });

          if (dryRun) {
            continue;
          }

          const payloads = await generarAagPayloadsDesdeTorneoWorker(tournamentId);

          if (!payloads.length) {
            runLog.push({
              tournament_id: tournamentId,
              tournament: torneo.name,
              action: "skip",
              reason: "No se generaron payloads AAG"
            });
            continue;
          }

          for (const item of payloads) {
            const { data: exportAnterior, error: oldError } = await supabase
              .from("aag_exports")
              .select(`
            id,
            aag_tournament_id,
            aag_remote_status,
            aag_last_check_at,
            aag_last_response
          `)
              .eq("tournament_id", tournamentId)
              .eq("tee_name", item.meta.tee_name)
              .eq("gender", item.meta.gender)
              .eq("is_current", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (oldError) throw oldError;

            await supabase
              .from("aag_exports")
              .update({
                status: "old",
                is_current: false
              })
              .eq("tournament_id", tournamentId)
              .eq("tee_name", item.meta.tee_name)
              .eq("gender", item.meta.gender)
              .eq("is_current", true);

            const { data: exp, error: insertError } = await supabase
              .from("aag_exports")
              .insert({
                tournament_id: tournamentId,
                source_type: "tournament",
                source_id: tournamentId,
                title: item.payload.Title,
                subtitle: item.payload.SubTitle,
                start_date: item.payload.StartDate.slice(0, 10),
                payload: item.payload,
                status: "pending",
                is_current: true,
                tee_name: item.meta.tee_name,
                gender: item.meta.gender,
                aag_teeout_id: item.meta.aag_teeout_id,
                aag_field_id: item.meta.aag_field_id,
                aag_tournament_id: exportAnterior?.aag_tournament_id || null,
                aag_remote_status: exportAnterior?.aag_remote_status || null,
                aag_last_check_at: exportAnterior?.aag_last_check_at || null,
                aag_last_response: exportAnterior?.aag_last_response || null
              })
              .select("*")
              .single();

            if (insertError) throw insertError;

            const payload = {
              ...exp.payload,
              ScoreCards: (exp.payload?.ScoreCards || []).map((card: any) => {
                const clean = { ...card };
                delete clean.Active;
                delete clean.InitialHole;
                delete clean.Id;
                return clean;
              })
            };

            const scorecardCount = Array.isArray(payload?.ScoreCards)
              ? payload.ScoreCards.length
              : 0;

            const res = await fetch(`${AAG_V2_BASE}/tournament`, {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            });

            const text = await res.text();

            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch (_) {
              parsed = null;
            }

            let exportStatus = "error";
            let aagTournamentId: number | null = null;

            let totalEvaluated: number | null = parsed?.TotalScoreCardEvaluated ?? null;
            let totalValid: number | null = parsed?.CountScoreCardValid ?? null;
            let totalWithError: number | null = parsed?.CountScoreCardWithError ?? null;
            let totalAdded: number | null = parsed?.TotalScoreCardAdded ?? null;

            if (parsed?.Success === true) {
              aagTournamentId = Number(parsed?.TournamentId || null);

              const total = Number(parsed?.TotalScoreCardEvaluated || 0);
              const valid = Number(parsed?.CountScoreCardValid || 0);
              const added = Number(parsed?.TotalScoreCardAdded || 0);
              const errors = Number(parsed?.CountScoreCardWithError || 0);

              if (total > 0 && errors === 0 && valid === total) {
                exportStatus = "sent";
              } else if (added > 0 || valid > 0) {
                exportStatus = "partial";
              } else {
                exportStatus = "error";
              }
            } else {
              const idMatch = text.match(/id:\s*(\d+)/i);

              if (res.ok && idMatch?.[1]) {
                aagTournamentId = Number(idMatch[1]);
                exportStatus = "sent";

                totalEvaluated = scorecardCount;
                totalValid = scorecardCount;
                totalWithError = 0;
                totalAdded = scorecardCount;
              } else if (!res.ok) {
                totalEvaluated = scorecardCount;
                totalValid = 0;
                totalWithError = scorecardCount;
                totalAdded = 0;
              }
            }

            await supabase
              .from("aag_exports")
              .update({
                status: exportStatus,
                aag_response: parsed || text,
                aag_error: parsed?.Errors?.length
                  ? JSON.stringify(parsed.Errors)
                  : (!res.ok ? text : null),
                sent_at: new Date().toISOString(),
                aag_tournament_id: aagTournamentId,
                aag_success: res.ok,
                aag_total_scorecards: totalEvaluated,
                aag_valid_scorecards: totalValid,
                aag_error_scorecards: totalWithError,
                aag_added_scorecards: totalAdded
              })
              .eq("id", exp.id);

            exportsSent++;

            if (exportStatus === "sent") exportsOk++;
            if (exportStatus === "partial") exportsPartial++;
            if (exportStatus === "error") exportsError++;

            runLog.push({
              tournament_id: tournamentId,
              tournament: torneo.name,
              export_id: exp.id,
              tee_name: exp.tee_name,
              gender: exp.gender,
              status: exportStatus,
              aag_tournament_id: aagTournamentId,
              metrics: {
                evaluated: totalEvaluated,
                valid: totalValid,
                with_error: totalWithError,
                added: totalAdded
              }
            });

            if (exportStatus === "partial" || exportStatus === "error") {
              await supabase
                .from("aag_notifications")
                .update({
                  status: "resolved",
                  resolved_at: new Date().toISOString()
                })
                .eq("export_id", exp.id)
                .eq("status", "open");

              await supabase
                .from("aag_notifications")
                .insert({
                  tournament_id: tournamentId,
                  export_id: exp.id,
                  severity: exportStatus === "partial" ? "warning" : "error",
                  status: "open",
                  title:
                    exportStatus === "partial"
                      ? "Exportación AAG automática parcial"
                      : "Error en exportación AAG automática",
                  message:
                    exportStatus === "partial"
                      ? `AAG aceptó solo una parte del envío automático: ${totalAdded ?? 0}/${totalEvaluated ?? scorecardCount} tarjetas agregadas.`
                      : "AAG rechazó el envío automático o no pudo procesarlo.",
                  details: {
                    run_id: runId,
                    export_status: exportStatus,
                    http_status: res.status,
                    aag_tournament_id: aagTournamentId,
                    metrics: {
                      evaluated: totalEvaluated,
                      valid: totalValid,
                      with_error: totalWithError,
                      added: totalAdded
                    },
                    response: parsed || text
                  }
                });

              await sendAagAlertEmail(
                exportStatus === "partial"
                  ? "⚠️ Exportación AAG automática parcial"
                  : "❌ Error exportación AAG automática",
                `
              <h2>${torneo.name || "Torneo"}</h2>
              <p><strong>Fecha:</strong> ${torneo.tournament_date || "-"}</p>
              <p><strong>Estado:</strong> ${exportStatus}</p>
              <p><strong>Tee:</strong> ${exp.tee_name || "-"}</p>
              <p><strong>Género:</strong> ${exp.gender || "-"}</p>
              <p>
                <strong>Tarjetas agregadas:</strong>
                ${totalAdded ?? 0} / ${totalEvaluated ?? scorecardCount}
              </p>
            `
              );
            }
          }
        }

        const finalStatus =
          exportsError > 0
            ? "error"
            : exportsPartial > 0
              ? "partial"
              : "success";

        await supabase
          .from("aag_export_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: finalStatus,
            tournaments_found: tournamentsFound,
            exports_sent: exportsSent,
            exports_ok: exportsOk,
            exports_partial: exportsPartial,
            exports_error: exportsError,
            log: runLog
          })
          .eq("id", runId);

        if (!dryRun && (exportsPartial > 0 || exportsError > 0)) {
          await sendAagAlertEmail(
            "⚠️ Revisión requerida: exportación automática AAG",
            `
          <h2>Exportación automática AAG finalizada con observaciones</h2>
          <p><strong>Exports enviados:</strong> ${exportsSent}</p>
          <p><strong>OK:</strong> ${exportsOk}</p>
          <p><strong>Parciales:</strong> ${exportsPartial}</p>
          <p><strong>Errores:</strong> ${exportsError}</p>
        `
          );
        }

        if (
          !dryRun &&
          exportsSent > 0 &&
          exportsPartial === 0 &&
          exportsError === 0
        ) {

          await sendAagAlertEmail(
            "✅ Exportación automática AAG completada",
            `
            <h2>Exportación automática completada</h2>

            <p>
              Torneos detectados:
              <strong>${tournamentsFound}</strong>
            </p>

            <p>
              Categorías exportadas:
              <strong>${exportsSent}</strong>
            </p>

            <p>
              Sin errores ni advertencias.
            </p>
          `
          );

        }

        return new Response(
          JSON.stringify({
            ok: true,
            dry_run: dryRun,
            run_id: runId,
            status: finalStatus,
            tournaments_found: tournamentsFound,
            exports_sent: exportsSent,
            exports_ok: exportsOk,
            exports_partial: exportsPartial,
            exports_error: exportsError,
            log: runLog
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );

      } catch (err) {
        await supabase
          .from("aag_export_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "error",
            error_text: String((err as any)?.message || err),
            log: runLog
          })
          .eq("id", runId);

        await sendAagAlertEmail(
          "❌ Error crítico en auto exportación AAG",
          `
        <h2>Error crítico en auto exportación AAG</h2>
        <p>${String((err as any)?.message || err)}</p>
      `
        );

        throw err;
      }
    }

    if (action === "search_player") {
      if (!enrollmentNumber) {
        throw new Error("Falta matrícula del jugador.");
      }

      const res = await fetch(`${AAG_BASE}/enrolleds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([enrollmentNumber]),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Error AAG ${res.status}: ${txt}`);
      }

      const data = await res.json();

      if (!data.length) {
        throw new Error("Jugador no encontrado en AAG.");
      }

      const p = data[0];

      const first = String(p.FirstNames || "").trim().toUpperCase();
      const last = String(p.LastNames || "").trim().toUpperCase();
      const clubId = Number(p.OptionClubId);

      const { data: club } = await supabase
        .from("aag_clubs")
        .select("club_name")
        .eq("option_club_id", clubId)
        .maybeSingle();

      const playerRow = {
        aag_member_number: String(p.EnrollmentNumber || "").trim(),
        first_name: first,
        last_name: last,
        gender: Number(p.Category) === 1 ? "female" : "male",
        current_index: Number(p.HandicapIndex),
        option_club_id: clubId,
        club_name: club?.club_name || `CLUB AAG ${clubId}`,
        source: "AAG",
        aag_last_sync_at: new Date().toISOString(),
        is_club_member: clubId === VMGC_OPTION_CLUB_ID,
        born_date: normalizarBornDate(p.BornDate),
        doc_number: p.DocNumber ? String(p.DocNumber).trim() : null,
        lowest_handicap_index: p.LowestHandicapIndex != null ? Number(p.LowestHandicapIndex) : null,
      };

      const { data: savedPlayer, error } = await supabase
        .from("players")
        .upsert(playerRow, { onConflict: "aag_member_number" })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          ok: true,
          player: savedPlayer,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "sync_fields") {
      /*
       * SINCRONIZACIÓN AUTORITATIVA AAG
       *
       * Objetivo:
       *   aag_teeouts debe quedar como espejo exacto de los TeeOuts
       *   que AAG devuelve actualmente.
       *
       * Seguridad:
       * - Primero descargamos y validamos TODA la respuesta AAG.
       * - Recién después hacemos upsert.
       * - La eliminación de obsoletos se ejecuta al final.
       * - Si AAG responde con error, formato inválido o sin tees,
       *   NO se elimina nada.
       */

      const res = await fetch(`${AAG_BASE}/fields`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Error AAG ${res.status}: ${txt}`);
      }

      const fields = await res.json();

      if (!Array.isArray(fields)) {
        throw new Error(
          "AAG devolvió un formato inválido en /fields. No se modificó el catálogo local."
        );
      }

      /*
       * Construir primero el snapshot remoto completo.
       * aag_teeout_id es la identidad numérica autoritativa de AAG.
       */
      const remoteTeeouts: any[] = [];

      for (const field of fields) {
        const tees = Array.isArray(field?.TeeOuts)
          ? field.TeeOuts
          : [];

        for (const tee of tees) {
          const teeId = Number(tee?.Id);

          if (!Number.isFinite(teeId)) {
            throw new Error(
              `AAG devolvió un TeeOut sin Id válido en el campo ${field?.Id ?? "desconocido"}. ` +
              `Se canceló la sincronización para no borrar datos locales por error.`
            );
          }

          remoteTeeouts.push({
            field,
            tee,
            teeId
          });
        }
      }

      /*
       * Una respuesta sin ningún TeeOut sería demasiado riesgosa para
       * interpretarla como "AAG eliminó todo". En ese caso abortamos.
       */
      if (remoteTeeouts.length === 0) {
        throw new Error(
          "AAG devolvió 0 TeeOuts. Se canceló la sincronización para evitar borrar todo aag_teeouts."
        );
      }

      const remoteTeeIds = [
        ...new Set(remoteTeeouts.map(x => Number(x.teeId)))
      ];

      /*
       * 1) UPSERT de campos vigentes.
       */
      for (const field of fields) {
        const { error: fieldError } = await supabase
          .from("aag_fields")
          .upsert({
            aag_field_id: field.Id,
            club_number: field.ClubNumber,
            field_number: field.FieldNumber,
            field_name: field.Description,
            holes_amount: field.HolesAmmount,
            observations: field.Observations,
            raw: field,
          }, { onConflict: "aag_field_id" });

        if (fieldError) throw fieldError;
      }

      /*
       * 2) UPSERT de TODOS los TeeOuts que AAG considera vigentes.
       */
      for (const item of remoteTeeouts) {
        const field = item.field;
        const tee = item.tee;

        const { error: teeError } = await supabase
          .from("aag_teeouts")
          .upsert({
            aag_field_id: field.Id,
            aag_teeout_id: tee.Id,
            teeout_number: tee.TeeOutNumber,
            tee_name: tee.Description,
            category: tee.Category,
            calification_in: tee.CalificationIn,
            calification_out: tee.CalificationOut,
            calification_total: tee.CalificationTotal,
            slope_in: tee.SlopeIn,
            slope_out: tee.SlopeOut,
            slope_total: tee.SlopeTotal,
            yards_total: tee.YardsTotal,
            holes: tee.Holes || [],
            raw: tee,
          }, { onConflict: "aag_teeout_id" });

        if (teeError) throw teeError;
      }

      /*
       * 3) Leer catálogo local DESPUÉS de los upserts.
       */
      const { data: localTeeouts, error: localError } = await supabase
        .from("aag_teeouts")
        .select("id, aag_teeout_id, aag_field_id, tee_name");

      if (localError) throw localError;

      const remoteIdSet = new Set(
        remoteTeeIds.map((id: number) => Number(id))
      );

      const obsoletos = (localTeeouts || []).filter((row: any) => {
        const localId = Number(row?.aag_teeout_id);

        return (
          Number.isFinite(localId) &&
          !remoteIdSet.has(localId)
        );
      });

      /*
       * 4) Eliminar solamente filas locales cuyo aag_teeout_id
       *    NO está en el snapshot remoto actual.
       *
       * Usamos el UUID interno "id" únicamente para ejecutar el DELETE.
       * La comparación siempre se hace por aag_teeout_id.
       */
      if (obsoletos.length > 0) {
        const uuidsObsoletos = obsoletos
          .map((row: any) => row.id)
          .filter(Boolean);

        if (uuidsObsoletos.length > 0) {
          const { error: deleteError } = await supabase
            .from("aag_teeouts")
            .delete()
            .in("id", uuidsObsoletos);

          if (deleteError) throw deleteError;
        }
      }

      /*
       * 5) Verificación final: el catálogo local debe contener exactamente
       *    los mismos aag_teeout_id que AAG devolvió.
       */
      const { data: finalTeeouts, error: finalError } = await supabase
        .from("aag_teeouts")
        .select("aag_teeout_id")
        .order("aag_teeout_id", { ascending: true });

      if (finalError) throw finalError;

      const finalIds = (finalTeeouts || [])
        .map((row: any) => Number(row.aag_teeout_id))
        .filter(Number.isFinite);

      const finalSet = new Set(finalIds);

      const faltantes = remoteTeeIds.filter(
        (id: number) => !finalSet.has(Number(id))
      );

      const sobrantes = finalIds.filter(
        (id: number) => !remoteIdSet.has(Number(id))
      );

      if (faltantes.length || sobrantes.length) {
        throw new Error(
          `La sincronización AAG terminó con diferencias. ` +
          `Faltantes: ${faltantes.join(", ") || "ninguno"}. ` +
          `Sobrantes: ${sobrantes.join(", ") || "ninguno"}.`
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          fields: fields.length,
          teeouts: remoteTeeIds.length,

          // Lo necesita el HTML para verificar / mostrar el espejo.
          teeout_ids: remoteTeeIds,

          // Auditoría de limpieza.
          deleted_teeouts: obsoletos.length,
          deleted_teeout_ids: obsoletos.map(
            (row: any) => Number(row.aag_teeout_id)
          ),
          deleted_tees: obsoletos.map((row: any) => ({
            aag_teeout_id: Number(row.aag_teeout_id),
            aag_field_id: row.aag_field_id,
            tee_name: row.tee_name
          })),

          mirror_ok: true
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "save_export") {
      const tournamentId = body.tournament_id;
      const payload = body.payload;
      const meta = body.meta || {};

      if (!tournamentId) {
        throw new Error("Falta tournament_id");
      }

      if (!payload) {
        throw new Error("Falta payload");
      }

      if (!meta.tee_name || !meta.gender) {
        throw new Error("Faltan datos meta del export");
      }

      const { data: torneoV2, error: torneoV2Error } = await supabase
        .from("tournaments")
        .select("id")
        .eq("id", tournamentId)
        .eq("data_schema_version", 2)
        .eq("status", "archived")
        .maybeSingle();

      if (torneoV2Error) throw torneoV2Error;
      if (!torneoV2) {
        throw new Error("Sólo se pueden preparar torneos versión 2 archivados.");
      }

      // Buscar export actual ANTES de invalidarlo
      const { data: exportAnterior, error: oldError } = await supabase
        .from("aag_exports")
        .select(`
      id,
      aag_tournament_id,
      aag_remote_status,
      aag_last_check_at,
      aag_last_response
    `)
        .eq("tournament_id", tournamentId)
        .eq("tee_name", meta.tee_name)
        .eq("gender", meta.gender)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (oldError) throw oldError;

      await supabase
        .from("aag_exports")
        .update({
          status: "old",
          is_current: false
        })
        .eq("tournament_id", tournamentId)
        .eq("tee_name", meta.tee_name)
        .eq("gender", meta.gender)
        .eq("is_current", true);

      const { data, error } = await supabase
        .from("aag_exports")
        .insert({
          tournament_id: tournamentId,

          source_type: "tournament",
          source_id: tournamentId,

          title: payload.Title,
          subtitle: payload.SubTitle,

          start_date: payload.StartDate.slice(0, 10),

          payload,

          status: "pending",
          is_current: true,

          tee_name: meta.tee_name,
          gender: meta.gender,

          aag_teeout_id: meta.aag_teeout_id,
          aag_field_id: meta.aag_field_id,

          // clave para que después use PUT y no POST
          aag_tournament_id: exportAnterior?.aag_tournament_id || null,
          aag_remote_status: exportAnterior?.aag_remote_status || null,
          aag_last_check_at: exportAnterior?.aag_last_check_at || null,
          aag_last_response: exportAnterior?.aag_last_response || null
        })
        .select("id, aag_tournament_id")
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          ok: true,
          export_id: data.id,
          aag_tournament_id: data.aag_tournament_id
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (action === "send_export") {
      const { export_id } = body;

      const { data: exp, error } = await supabase
        .from("aag_exports")
        .select("*")
        .eq("id", export_id)
        .single();

      if (error || !exp) {
        throw new Error("Export no encontrado");
      }

      const payload = {
        ...exp.payload,
        ScoreCards: (exp.payload?.ScoreCards || []).map((card: any) => {
          const clean = { ...card };

          delete clean.Active;
          delete clean.InitialHole;
          delete clean.Id;

          return clean;
        })
      };

      const scorecardCount = Array.isArray(payload?.ScoreCards)
        ? payload.ScoreCards.length
        : 0;

      console.log("AAG SEND URL V2:", `${AAG_V2_BASE}/tournament`);

      const res = await fetch(`${AAG_V2_BASE}/tournament`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
      }

      let exportStatus = "error";
      let tournamentId: number | null = null;

      // Métricas. Si alguna vez AAG habilita v2, usamos las métricas reales.
      // Si responde v1 exitoso, inferimos que entraron todas porque v1 es estricto.
      let totalEvaluated: number | null = parsed?.TotalScoreCardEvaluated ?? null;
      let totalValid: number | null = parsed?.CountScoreCardValid ?? null;
      let totalWithError: number | null = parsed?.CountScoreCardWithError ?? null;
      let totalAdded: number | null = parsed?.TotalScoreCardAdded ?? null;

      if (parsed?.Success === true) {
        tournamentId = Number(parsed?.TournamentId || null);

        const total = Number(parsed?.TotalScoreCardEvaluated || 0);
        const valid = Number(parsed?.CountScoreCardValid || 0);
        const added = Number(parsed?.TotalScoreCardAdded || 0);
        const errors = Number(parsed?.CountScoreCardWithError || 0);

        if (total > 0 && errors === 0 && valid === total) {
          exportStatus = "sent";
        } else if (added > 0 || valid > 0) {
          exportStatus = "partial";
        } else {
          exportStatus = "error";
        }
      } else {
        const idMatch = text.match(/id:\s*(\d+)/i);

        if (res.ok && idMatch?.[1]) {
          tournamentId = Number(idMatch[1]);
          exportStatus = "sent";

          // Fallback v1: si el torneo se creó, v1 aceptó todas las tarjetas.
          totalEvaluated = scorecardCount;
          totalValid = scorecardCount;
          totalWithError = 0;
          totalAdded = scorecardCount;
        } else if (!res.ok) {
          // Fallback para error v1: no se agregó ninguna.
          totalEvaluated = scorecardCount;
          totalValid = 0;
          totalWithError = scorecardCount;
          totalAdded = 0;
        }
      }

      await supabase
        .from("aag_exports")
        .update({
          status: exportStatus,
          aag_response: parsed || text,
          aag_error: parsed?.Errors?.length
            ? JSON.stringify(parsed.Errors)
            : (!res.ok ? text : null),
          sent_at: new Date().toISOString(),
          aag_tournament_id: tournamentId,
          aag_success: res.ok,
          aag_total_scorecards: totalEvaluated,
          aag_valid_scorecards: totalValid,
          aag_error_scorecards: totalWithError,
          aag_added_scorecards: totalAdded,
        })
        .eq("id", export_id);

      if (exportStatus === "partial" || exportStatus === "error") {
        await supabase
          .from("aag_notifications")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString()
          })
          .eq("export_id", exp.id)
          .eq("status", "open");


        await supabase
          .from("aag_notifications")
          .insert({
            tournament_id: exp.tournament_id,
            export_id: exp.id,
            severity: exportStatus === "partial" ? "warning" : "error",
            status: "open",
            title:
              exportStatus === "partial"
                ? "Exportación AAG parcial"
                : "Error en exportación AAG",
            message:
              exportStatus === "partial"
                ? `AAG aceptó solo una parte del envío: ${totalAdded ?? 0}/${totalEvaluated ?? scorecardCount} tarjetas agregadas.`
                : `AAG rechazó el envío o no pudo procesarlo.`,
            details: {
              export_status: exportStatus,
              http_status: res.status,
              aag_tournament_id: tournamentId,
              metrics: {
                evaluated: totalEvaluated,
                valid: totalValid,
                with_error: totalWithError,
                added: totalAdded
              },
              response: parsed || text
            }
          });

        await sendAagAlertEmail(
          exportStatus === "partial"
            ? "⚠️ Exportación AAG parcial"
            : "❌ Error exportación AAG",

          `
    <h2>${exp.payload?.Title || "Torneo"}</h2>

    <p>
      Estado:
      <strong>${exportStatus}</strong>
    </p>

    <p>
      Tarjetas agregadas:
      <strong>${totalAdded ?? 0}</strong>
      /
      <strong>${totalEvaluated ?? scorecardCount}</strong>
    </p>

    <p>
      Tee:
      ${exp.tee_name || "-"}
    </p>

    <p>
      Género:
      ${exp.gender || "-"}
    </p>
  `
        );
      }

      return new Response(
        JSON.stringify({
          ok: res.ok,
          status: res.status,
          response: text,
          metrics: {
            evaluated: totalEvaluated,
            valid: totalValid,
            with_error: totalWithError,
            added: totalAdded,
          },
          aag_tournament_id: tournamentId,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "update_export") {

      const exportId = body.export_id;

      if (!exportId) {
        throw new Error("Falta export_id");
      }

      const { data: exp, error: expError } =
        await supabase
          .from("aag_exports")
          .select("*")
          .eq("id", exportId)
          .single();

      if (expError || !exp) {
        throw new Error("Export no encontrado");
      }

      if (!exp.aag_tournament_id) {
        throw new Error("El export no tiene aag_tournament_id");
      }

      const localScorecards = Array.isArray(exp.payload?.ScoreCards)
        ? exp.payload.ScoreCards.length
        : 0;

      if (localScorecards <= 0) {
        throw new Error(
          "No se puede modificar AAG: el payload local tiene 0 tarjetas. El PUT borraría las tarjetas del torneo."
        );
      }

      // Consultar estado real antes de modificar
      const checkRes = await fetch(
        `${AAG_BASE}/tournament?id=${exp.aag_tournament_id}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        }
      );

      const checkText = await checkRes.text();

      let remote: any = null;
      try {
        remote = JSON.parse(checkText);
      } catch (_) {
        remote = null;
      }

      const remoteStatus = remote?.Status || null;
      const remoteBeforeScorecards = countEffectiveRemoteScorecards(remote?.ScoreCards);

      await supabase
        .from("aag_exports")
        .update({
          aag_remote_status: remoteStatus,
          aag_last_check_at: new Date().toISOString(),
          aag_last_response: remote || checkText,
          aag_last_sync_ok: checkRes.ok
        })
        .eq("id", exportId);

      if (!checkRes.ok) {
        throw new Error(
          `No pude consultar el torneo AAG antes de actualizar. Respuesta: ${checkText}`
        );
      }

      if (remoteStatus !== "Abierto") {
        throw new Error(
          `No se puede actualizar. Estado AAG actual: ${remoteStatus || "desconocido"}`
        );
      }

      // Como PUT deja el torneo con 0 tarjetas visibles en AAG,
      // hacemos reemplazo seguro: DELETE + POST.
      const payload = {
        Id: Number(exp.aag_tournament_id),
        Title: String(exp.payload.Title || "").slice(0, 60),
        SubTitle: String(exp.payload.SubTitle || "").slice(0, 60),
        GameMode: Number(exp.payload.GameMode || 1),
        BatchesHoles: Number(exp.payload.BatchesHoles || 18),
        BatchesCount: Number(exp.payload.BatchesCount || 1),
        StartDate: exp.payload.StartDate,
        Field: Number(exp.payload.Field),
        TeeOut: Number(exp.payload.TeeOut),
        Category: Number(exp.payload.Category || 0),
        EndHandicap: Number(exp.payload.EndHandicap || 36),
        ScoreCards: exp.payload.ScoreCards
      };

      delete payload.Id;

      const deleteRes = await fetch(
        `${AAG_BASE}/tournament?id=${exp.aag_tournament_id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }
      );

      const deleteText = await deleteRes.text();

      if (!deleteRes.ok) {
        throw new Error(
          `No se pudo eliminar el torneo AAG anterior antes de reenviar. Respuesta: ${deleteText}`
        );
      }

      const res = await fetch(
        `${AAG_BASE}/tournament`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const text = await res.text();

      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = null;
      }

      const idMatch = text.match(/id:\s*(\d+)/i) || text.match(/\d+/);
      const newTournamentId =
        parsed?.TournamentId
          ? Number(parsed.TournamentId)
          : idMatch
            ? Number(idMatch[1] || idMatch[0])
            : null;

      if (!res.ok || !newTournamentId) {
        throw new Error(
          `Se eliminó el torneo anterior, pero falló el nuevo envío AAG. Respuesta: ${text}`
        );
      }

      // Consultar cómo quedó el nuevo torneo
      const afterRes = await fetch(
        `${AAG_BASE}/tournament?id=${newTournamentId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        }
      );

      const afterText = await afterRes.text();

      let remoteAfter: any = null;
      try {
        remoteAfter = JSON.parse(afterText);
      } catch (_) {
        remoteAfter = null;
      }

      const remoteAfterStatus = remoteAfter?.Status || null;
      const remoteAfterScorecards = countEffectiveRemoteScorecards(remoteAfter?.ScoreCards);

      const exportStatus =
        res.ok && remoteAfterScorecards && remoteAfterScorecards > 0
          ? "sent"
          : "error";

      await supabase
        .from("aag_exports")
        .update({
          status: exportStatus,
          aag_response: {
            mode: "DELETE_AND_POST",
            deleted_old_id: exp.aag_tournament_id,
            delete_response: deleteText,
            post_response: text,
            new_aag_tournament_id: newTournamentId,
            after_scorecards: remoteAfterScorecards,
            after_status: remoteAfterStatus
          },
          aag_error: exportStatus === "error"
            ? `AAG recibió el nuevo torneo, pero quedó con ${remoteAfterScorecards ?? "sin dato"} tarjetas.`
            : null,
          sent_at: new Date().toISOString(),
          aag_tournament_id: newTournamentId,
          aag_success: exportStatus === "sent",
          aag_remote_status: remoteAfterStatus,
          aag_last_check_at: new Date().toISOString(),
          aag_last_sync_ok: exportStatus === "sent",

          aag_total_scorecards: localScorecards,
          aag_valid_scorecards: remoteAfterScorecards,
          aag_error_scorecards:
            remoteAfterScorecards === null
              ? null
              : Math.max(localScorecards - remoteAfterScorecards, 0),
          aag_added_scorecards: remoteAfterScorecards,

          aag_last_response: remoteAfter || afterText || text
        })
        .eq("id", exportId);

      return new Response(
        JSON.stringify({
          ok: exportStatus === "sent",
          status: res.status,
          response: text,
          mode: "DELETE_AND_POST",
          old_aag_tournament_id: exp.aag_tournament_id,
          aag_tournament_id: newTournamentId,
          remote_status: remoteAfterStatus,
          metrics: {
            evaluated: localScorecards,
            valid: remoteAfterScorecards,
            with_error:
              remoteAfterScorecards === null
                ? null
                : Math.max(localScorecards - remoteAfterScorecards, 0),
            added: remoteAfterScorecards
          },
          update_summary: {
            deleted_old_id: exp.aag_tournament_id,
            new_aag_tournament_id: newTournamentId,
            sent_scorecards: localScorecards,
            after_scorecards: remoteAfterScorecards,
            match: remoteAfterScorecards === localScorecards
          }
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );

    }

    if (action === "get_tournament") {

      const tournamentId = body.tournament_id;

      if (!tournamentId) {
        throw new Error("Falta tournament_id.");
      }

      const res = await fetch(
        `${AAG_BASE}/tournament?id=${tournamentId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        }
      );

      const text = await res.text();

      return new Response(
        JSON.stringify({
          ok: res.ok,
          status: res.status,
          response: text,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "refresh_all_exports") {
      const { data: exportsData, error: exportsError } = await supabase
        .from("aag_exports")
        .select("id, aag_tournament_id, aag_total_scorecards, aag_remote_status")
        .eq("is_current", true)
        .not("aag_tournament_id", "is", null)
        .order("created_at", { ascending: true });

      if (exportsError) throw exportsError;

      const results: any[] = [];
      let checked = 0;
      let changed = 0;
      let errors = 0;

      const refreshOne = async (exp: any) => {
        const checkedAt = new Date().toISOString();
        try {
          const response = await fetch(
            `${AAG_BASE}/tournament?id=${exp.aag_tournament_id}`,
            {
              method: "GET",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json"
              }
            }
          );

          const text = await response.text();
          let remote: any = null;
          try { remote = text ? JSON.parse(text) : null; } catch (_) { remote = null; }

          const remoteStatus = remote?.Status || remote?.status || null;
          const remoteScorecards = countEffectiveRemoteScorecards(remote?.ScoreCards);
          const localScorecards = Number(exp.aag_total_scorecards || 0);
          const changes: any = {
            aag_remote_status: remoteStatus,
            aag_last_check_at: checkedAt,
            aag_last_response: remote || text,
            aag_last_sync_ok: response.ok,
            aag_valid_scorecards: remoteScorecards,
            aag_added_scorecards: remoteScorecards,
            aag_error_scorecards: remoteScorecards === null
              ? null
              : Math.max(localScorecards - remoteScorecards, 0)
          };
          if (response.ok) changes.status = "sent";

          const { error: updateError } = await supabase
            .from("aag_exports")
            .update(changes)
            .eq("id", exp.id);
          if (updateError) throw updateError;

          checked++;
          if (exp.aag_remote_status !== remoteStatus) changed++;
          if (!response.ok) errors++;
          results.push({
            export_id: exp.id,
            aag_tournament_id: exp.aag_tournament_id,
            ok: response.ok,
            remote_status: remoteStatus,
            scorecards: remoteScorecards
          });
        } catch (error) {
          errors++;
          await supabase
            .from("aag_exports")
            .update({
              aag_last_check_at: checkedAt,
              aag_last_sync_ok: false,
              aag_last_response: String(error)
            })
            .eq("id", exp.id);
          results.push({ export_id: exp.id, ok: false, error: String(error) });
        }
      };

      const batchSize = 5;
      for (let index = 0; index < (exportsData || []).length; index += batchSize) {
        await Promise.all((exportsData || []).slice(index, index + batchSize).map(refreshOne));
      }

      return new Response(
        JSON.stringify({ ok: true, checked, changed, errors, results }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    if (action === "refresh_tournament_exports") {

      const tournamentId = body.tournament_id;

      if (!tournamentId) {
        throw new Error("Falta tournament_id");
      }

      // 👉 traer exports actuales
      const { data: exportsData, error: exportsError } =
        await supabase
          .from("aag_exports")
          .select("*")
          .eq("tournament_id", tournamentId)
          .eq("is_current", true)
          .not("aag_tournament_id", "is", null);

      if (exportsError) {
        throw exportsError;
      }

      const resultados = [];

      for (const exp of exportsData || []) {

        try {

          const res = await fetch(
            `${AAG_BASE}/tournament?id=${exp.aag_tournament_id}`,
            {
              method: "GET",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
              },
            }
          );

          const text = await res.text();

          let parsed: any = null;

          try {
            parsed = JSON.parse(text);

            console.log(parsed);

          } catch (_) {
            parsed = null;
          }

          const remoteStatus =
            parsed?.Status || null;

          // 👉 guardar snapshot REAL
          await supabase
            .from("aag_exports")
            .update({

              aag_remote_status:
                remoteStatus,

              aag_last_check_at:
                new Date().toISOString(),

              aag_last_response:
                parsed || text,

              aag_last_sync_ok:
                res.ok

            })
            .eq("id", exp.id);

          resultados.push({
            export_id: exp.id,
            aag_tournament_id:
              exp.aag_tournament_id,

            ok: res.ok,

            remote_status:
              remoteStatus
          });

        } catch (err) {

          resultados.push({
            export_id: exp.id,
            error: String(err)
          });
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          results: resultados
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (action === "delete_tournament") {

      const exportId = body.export_id;

      if (!exportId) {
        throw new Error("Falta export_id");
      }

      const { data: exp, error: expError } = await supabase
        .from("aag_exports")
        .select("*")
        .eq("id", exportId)
        .single();

      if (expError || !exp) {
        throw new Error("Export no encontrado");
      }

      if (!exp.aag_tournament_id) {
        throw new Error("El export no tiene aag_tournament_id");
      }

      if (exp.aag_remote_status && exp.aag_remote_status !== "Abierto") {
        throw new Error(
          `No se puede eliminar. Estado AAG actual: ${exp.aag_remote_status}`
        );
      }

      const res = await fetch(
        `${AAG_BASE}/tournament?id=${exp.aag_tournament_id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }
      );

      const text = await res.text();

      if (!res.ok) {
        await supabase
          .from("aag_exports")
          .update({
            aag_last_response: text,
            aag_last_sync_ok: false,
            aag_last_check_at: new Date().toISOString()
          })
          .eq("id", exportId);

        throw new Error(text || "AAG no permitió eliminar el torneo");
      }

      await supabase
        .from("aag_exports")
        .update({
          status: "deleted",
          is_current: false,
          deleted_at: new Date().toISOString(),
          aag_remote_status: "Borrado",
          aag_last_response: text,
          aag_last_sync_ok: true,
          aag_last_check_at: new Date().toISOString()
        })
        .eq("id", exportId);

      return new Response(
        JSON.stringify({
          ok: true,
          status: res.status,
          response: text
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    const res = await fetch(`${AAG_BASE}/Allenrolleds`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error AAG ${res.status}: ${txt}`);
    }

    const allPlayers = await res.json();

    const { data: clubsData, error: clubsError } = await supabase
      .from("aag_clubs")
      .select("option_club_id, club_name, city, province");

    if (clubsError) throw clubsError;

    const clubById = new Map(
      (clubsData || []).map((c: any) => [Number(c.option_club_id), c])
    );

    const enrolledRows = allPlayers
      .map((p: any) => {
        const first = String(p.FirstNames || "").trim().toUpperCase();
        const last = String(p.LastNames || "").trim().toUpperCase();
        const clubId = Number(p.OptionClubId);
        const club = clubById.get(clubId);

        return {
          enrollment_number: String(p.EnrollmentNumber || "").trim(),
          first_name: first,
          last_name: last,
          full_name: `${last}, ${first}`,
          gender: Number(p.Category) === 1 ? "female" : "male",
          current_index: Number(p.HandicapIndex),
          option_club_id: clubId,
          club_name: club?.club_name || `CLUB AAG ${clubId}`,
          search_text: `${last} ${first} ${first} ${last} ${p.EnrollmentNumber || ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase(),
          last_sync_at: new Date().toISOString(),
          born_date: normalizarBornDate(p.BornDate),
          doc_number: p.DocNumber ? String(p.DocNumber).trim() : null,
          lowest_handicap_index: p.LowestHandicapIndex != null ? Number(p.LowestHandicapIndex) : null,
        };
      })
      .filter((p: any) => p.enrollment_number);

    const enrolledUniqueMap = new Map();

    for (const row of enrolledRows) {
      enrolledUniqueMap.set(row.enrollment_number, row);
    }

    const enrolledUniqueRows = Array.from(enrolledUniqueMap.values());

    // ===================================================
    // REEMPLAZAR PADRÓN AAG COMPLETO
    // aag_enrolleds debe quedar igual al padrón recibido
    // ===================================================

    const { error: deleteEnrolledError } = await supabase
      .from("aag_enrolleds")
      .delete()
      .neq("enrollment_number", "__NO_EXISTE__");

    if (deleteEnrolledError) throw deleteEnrolledError;

    for (let i = 0; i < enrolledUniqueRows.length; i += 500) {
      const chunk = enrolledUniqueRows.slice(i, i + 500);

      const { error } = await supabase
        .from("aag_enrolleds")
        .insert(chunk);

      if (error) throw error;
    }

    // ===================================================
    // ACTUALIZAR PLAYERS EXISTENTES QUE NO SON VMGC
    // ===================================================

    const { data: playersConMatricula, error: playersMatError } = await supabase
      .from("players")
      .select(`
    id,
    aag_member_number
  `)
      .not("aag_member_number", "is", null);

    if (playersMatError) throw playersMatError;

    const matriculasEnPlayers = new Set(
      (playersConMatricula || [])
        .map((p: any) => String(p.aag_member_number || "").trim())
        .filter(Boolean)
    );

    const rowsPlayersExistentes = enrolledRows
      .filter((p: any) =>
        matriculasEnPlayers.has(String(p.enrollment_number || "").trim())
      )
      .map((p: any) => {
        const clubId = Number(p.option_club_id);
        const club = clubById.get(clubId);

        return {
          aag_member_number: String(p.enrollment_number || "").trim(),
          first_name: p.first_name,
          last_name: p.last_name,
          gender: p.gender,
          current_index: Number(p.current_index),
          option_club_id: clubId,
          club_name: club?.club_name || p.club_name || `CLUB AAG ${clubId}`,
          club_city: club?.city || null,
          club_province: club?.province || null,
          source: "AAG",
          aag_last_sync_at: new Date().toISOString(),
          is_aag_active: true,
          is_club_member: clubId === VMGC_OPTION_CLUB_ID,
          born_date: p.born_date || null,
          doc_number: p.doc_number || null,
          lowest_handicap_index: p.lowest_handicap_index ?? null,
          search_text: `${p.last_name} ${p.first_name} ${p.first_name} ${p.last_name} ${p.enrollment_number}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase(),
        };
      });

    for (let i = 0; i < rowsPlayersExistentes.length; i += 500) {
      const chunk = rowsPlayersExistentes.slice(i, i + 500);

      const { error } = await supabase
        .from("players")
        .upsert(chunk, { onConflict: "aag_member_number" });

      if (error) throw error;
    }

    // ===================================================
    // VMGC PLAYERS
    // ===================================================

    const vmgcPlayers = allPlayers.filter((p: any) =>
      Number(p.OptionClubId) === VMGC_OPTION_CLUB_ID
    );

    const cambios: {
      added: any[];
      updated: any[];
      deactivated: any[];
    } = {
      added: [],
      updated: [],
      deactivated: [],
    };

    const { data: playersActuales, error: actualesPlayersError } = await supabase
      .from("players")
      .select(`
    id,
    first_name,
    last_name,
    full_name,
    aag_member_number,
    current_index,
    option_club_id,
    club_name,
    club_city,
    club_province,
    is_aag_active,
    is_club_member,
    source
  `)
      .not("aag_member_number", "is", null);

    if (actualesPlayersError) throw actualesPlayersError;

    const playersMap = new Map(
      (playersActuales || []).map((p: any) => [
        String(p.aag_member_number || "").trim(),
        p,
      ])
    );

    const rows = vmgcPlayers
      .map((p: any) => {
        const first = String(p.FirstNames || "").trim().toUpperCase();
        const last = String(p.LastNames || "").trim().toUpperCase();
        const enrollment = String(p.EnrollmentNumber || "").trim();
        const clubId = Number(p.OptionClubId);
        const club = clubById.get(clubId);

        const fullName = `${last}, ${first}`;

        const row = {
          aag_member_number: enrollment,
          first_name: first,
          last_name: last,
          gender: Number(p.Category) === 1 ? "female" : "male",
          current_index: Number(p.HandicapIndex),
          option_club_id: clubId,
          club_name: club?.club_name || `CLUB AAG ${clubId}`,
          club_city: club?.city || null,
          club_province: club?.province || null,
          source: "AAG",
          aag_last_sync_at: new Date().toISOString(),
          is_club_member: true,
          is_aag_active: true,
          born_date: normalizarBornDate(p.BornDate),
          doc_number: p.DocNumber ? String(p.DocNumber).trim() : null,
          lowest_handicap_index: p.LowestHandicapIndex != null ? Number(p.LowestHandicapIndex) : null,
          search_text: `${last} ${first} ${first} ${last} ${enrollment}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase(),
        };

        const actual = playersMap.get(enrollment);

        if (!actual) {
          cambios.added.push({
            matricula: enrollment,
            nombre: fullName,
            index: row.current_index,
            club: row.club_name,
          });
        } else {
          const cambiosJugador = [];

          if (Number(actual.current_index ?? -999) !== Number(row.current_index ?? -999)) {
            cambiosJugador.push(`Index ${actual.current_index ?? "—"} → ${row.current_index ?? "—"}`);
          }

          if (String(actual.club_name || "") !== String(row.club_name || "")) {
            cambiosJugador.push(`Club ${actual.club_name || "—"} → ${row.club_name || "—"}`);
          }

          if (String(actual.club_city || "") !== String(row.club_city || "")) {
            cambiosJugador.push(`Localidad ${actual.club_city || "—"} → ${row.club_city || "—"}`);
          }

          if (String(actual.club_province || "") !== String(row.club_province || "")) {
            cambiosJugador.push(`Provincia ${actual.club_province || "—"} → ${row.club_province || "—"}`);
          }

          if (actual.is_aag_active === false) {
            cambiosJugador.push("Reactivado AAG");
          }

          if (actual.is_club_member === false) {
            cambiosJugador.push("Reactivado como socio VMGC");
          }

          if (cambiosJugador.length) {
            cambios.updated.push({
              matricula: enrollment,
              nombre: fullName,
              changes: cambiosJugador,
            });
          }
        }

        return row;
      })
      .filter((p: any) => p.aag_member_number);

    let totalUpserted = 0;

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);

      const { error } = await supabase
        .from("players")
        .upsert(chunk, { onConflict: "aag_member_number" });

      if (error) throw error;

      totalUpserted += chunk.length;
    }

    // ===================================================
    // BAJAS VMGC
    // ===================================================

    const matriculasActualesAag = new Set(
      rows
        .map((p: any) => String(p.aag_member_number || "").trim())
        .filter(Boolean)
    );

    const jugadoresVmgcPrevios = (playersActuales || []).filter((p: any) =>
      Number(p.option_club_id) === VMGC_OPTION_CLUB_ID &&
      String(p.source || "") === "AAG"
    );

    const idsParaDesactivar = jugadoresVmgcPrevios
      .filter((p: any) =>
        !matriculasActualesAag.has(String(p.aag_member_number || "").trim())
      );

    if (idsParaDesactivar.length > 0) {
      cambios.deactivated = idsParaDesactivar.map((p: any) => ({
        matricula: p.aag_member_number,
        nombre:
          p.full_name ||
          `${p.last_name || ""}, ${p.first_name || ""}`.trim(),
        index: p.current_index,
        club: p.club_name,
      }));

      const { error: inactiveError } = await supabase
        .from("players")
        .update({
          current_index: null,
          is_aag_active: false,
          source: "manual",
          option_club_id: null,
          is_active: false,
          is_club_member: false,
          club_name: null,
          club_city: null,
          club_province: null,
          aag_last_sync_at: new Date().toISOString(),
        })
        .in("id", idsParaDesactivar.map((p: any) => p.id));

      if (inactiveError) throw inactiveError;
    }

    await supabase
      .from("aag_sync_logs")
      .insert({
        total_received: allPlayers.length,
        total_filtered: vmgcPlayers.length,
        total_upserted: totalUpserted,
        added_count: cambios.added.length,
        updated_count: cambios.updated.length,
        deactivated_count: cambios.deactivated.length,
        changes: cambios,
        success: true,
      });

    return new Response(
      JSON.stringify({
        ok: true,
        total_received: allPlayers.length,
        total_filtered: vmgcPlayers.length,
        total_upserted: totalUpserted,
        changes: cambios,
        summary: {
          added: cambios.added.length,
          updated: cambios.updated.length,
          deactivated: cambios.deactivated.length,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (err) {
    try {
      if (supabase) {
        await supabase
          .from("aag_sync_logs")
          .insert({
            success: false,
            error_text: String((err as any)?.message || err),
          });
      }
    } catch (_) { }

    return new Response(
      JSON.stringify({
        ok: false,
        error: String((err as any)?.message || err),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
