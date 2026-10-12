let qzSecurityReady = false;
let qzClubLogoPromise;

async function ticketClubHeader() {
  if (!qzClubLogoPromise) {
    qzClubLogoPromise = fetch("./escudo.png", { cache: "force-cache" }).then(async response => {
      if (!response.ok) throw new Error("No se pudo cargar el escudo para el cupón.");
      const blob = await response.blob();
      return await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("No se pudo preparar el escudo."));
        reader.readAsDataURL(blob);
      });
    }).catch(error => { qzClubLogoPromise = null; throw error; });
  }
  const logo = await qzClubLogoPromise;
  return `<div class="ticket-club-header" style="text-align:center;margin-bottom:5px"><img src="${logo}" alt="" style="display:block;width:14mm;height:18mm;object-fit:contain;margin:0 auto 3px"><div style="font-size:14px;font-weight:700">Villa María Golf Club</div></div>`;
}

async function prepareClubTicket(html) {
  const header = await ticketClubHeader();
  // Replace the previous text-only club title in existing tournament/free-card coupons.
  html = html.replace(/<div style="text-align:center;font-size:14px;font-weight:700">Villa María Golf Club<\/div>/g, "");
  if (/<div class="ticket-80">/.test(html)) return html.replace('<div class="ticket-80">','<div class="ticket-80">'+header);
  return '<div class="ticket-80">'+header+html+'</div>';
}

async function leerTexto(url, nombre) {
  const res = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });

  if (!res.ok) {
    throw new Error("No se pudo cargar " + nombre + " - HTTP " + res.status);
  }

  const txt = (await res.text()).trim();

  if (!txt || txt.startsWith("<!DOCTYPE") || txt.startsWith("<html")) {
    throw new Error(nombre + " está devolviendo HTML, no el archivo correcto");
  }

  return txt;
}

async function configurarSeguridadQZ() {
  if (qzSecurityReady) return;

  const perfilQZ = localStorage.getItem("vmgc_qz_profile") || "pc1";

  const archivoCertificado = `./qz-certificate-${perfilQZ}.txt`;
  const archivoClave = `./qz-private-key-${perfilQZ}.pem`;

  if (typeof KEYUTIL === "undefined" || typeof KJUR === "undefined") {
    throw new Error("No está cargado jsrsasign. Revisá el script en el HEAD.");
  }

  qz.security.setCertificatePromise(function (resolve, reject) {
    leerTexto(archivoCertificado, archivoCertificado)
      .then(function (cert) {
        if (!cert.includes("BEGIN CERTIFICATE")) {
          reject("El certificado no es válido");
          return;
        }

        resolve(cert);
      })
      .catch(reject);
  });

  qz.security.setSignatureAlgorithm("SHA512");

  qz.security.setSignaturePromise(function (toSign) {
    return function (resolve, reject) {
      leerTexto(archivoClave, archivoClave)
        .then(function (privateKey) {
          if (!privateKey.includes("BEGIN PRIVATE KEY")) {
            reject("La private key no es válida");
            return;
          }

          try {
            const rsa = KEYUTIL.getKey(privateKey);
            const sig = new KJUR.crypto.Signature({ alg: "SHA512withRSA" });

            sig.init(rsa);
            sig.updateString(toSign);

            const hex = sig.sign();
            const base64 = hextob64(hex);

            resolve(base64);
          } catch (e) {
            reject("Error firmando con private key: " + (e.message || e));
          }
        })
        .catch(reject);
    };
  });

  qzSecurityReady = true;
}

window.imprimirTicketQZ = async function (html) {
  try {
    if (typeof qz === "undefined") throw new Error("No está cargada la biblioteca QZ Tray.");
    html = await prepareClubTicket(html);
    await configurarSeguridadQZ();

    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }

    const printers = await qz.printers.find();

    let printerName = localStorage.getItem("vmgc_ticket_printer");

    if (printerName && !printers.includes(printerName)) {
      localStorage.removeItem("vmgc_ticket_printer");
      printerName = null;
    }

    if (!printerName) {
      const opciones = printers.filter(p =>
        String(p).toUpperCase().includes("EPSON") ||
        String(p).toUpperCase().includes("POS") ||
        String(p).toUpperCase().includes("RECEIPT")
      );

      const listado = opciones
        .map((p, i) => `${i + 1}) ${p}`)
        .join("\n");

      const elegida = prompt(
        "Elegí la impresora térmica para ESTA PC:\n\n" + listado
      );

      const index = Number(elegida) - 1;
      printerName = opciones[index];

      if (!printerName) {
        throw new Error("No se seleccionó una impresora válida. El cupón no fue impreso.");
      }

      localStorage.setItem("vmgc_ticket_printer", printerName);
    }

    console.log("IMPRESORA USADA:", printerName);

    let ticketHeight = 120;
    if (typeof document !== "undefined") {
      const measure = document.createElement("div");
      measure.style.cssText = "position:absolute;left:-10000px;top:0;width:80mm;font:12px Arial,sans-serif;";
      measure.innerHTML = html;
      const ticket = measure.querySelector(".ticket-80");
      if (ticket) ticket.style.cssText += ";width:72mm;margin:0 auto;padding:4mm;box-sizing:border-box;overflow-wrap:anywhere;word-wrap:break-word;";
      document.body.appendChild(measure);
      ticketHeight = Math.max(120, Math.ceil(measure.scrollHeight * 25.4 / 96 + 5));
      measure.remove();
    }
    const config = qz.configs.create(printerName, {
      units: "mm",
      size: { width: 80, height: ticketHeight },
      margins: 0,
      scaleContent: true
    });

    const contenido =
      '<html><head><style>' +
      'html,body{margin:0;padding:0;width:80mm;font-family:Arial,sans-serif;color:#000;}' +
      '.ticket-80{width:72mm;margin:0 auto;padding:4mm;box-sizing:border-box;font-size:12px;overflow-wrap:anywhere;word-wrap:break-word;}' +
      '</style></head><body>' +
      html +
      '</body></html>';

    await qz.print(config, [{
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: contenido
    }]);

  } catch (err) {
    console.error("ERROR QZ:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
};
