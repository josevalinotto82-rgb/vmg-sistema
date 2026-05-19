let qzSecurityReady = false;

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

  if (typeof KEYUTIL === "undefined" || typeof KJUR === "undefined") {
    throw new Error("No está cargado jsrsasign. Revisá el script en el HEAD.");
  }

  qz.security.setCertificatePromise(function (resolve, reject) {
    leerTexto("./qz-certificate.txt", "qz-certificate.txt")
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
      leerTexto("./qz-private-key.pem", "qz-private-key.pem")
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
        alert("No elegiste una impresora válida.");
        return;
      }

      localStorage.setItem("vmgc_ticket_printer", printerName);
    }

    console.log("IMPRESORA USADA:", printerName);

    const config = qz.configs.create(printerName, {
      units: "mm",
      size: { width: 80, height: 120 },
      margins: 0,
      scaleContent: true
    });

    const contenido =
      '<html><head><style>' +
      'html,body{margin:0;padding:0;width:80mm;font-family:Arial,sans-serif;color:#000;}' +
      '.ticket-80{width:72mm;margin:0 auto;padding:4mm;box-sizing:border-box;font-size:12px;}' +
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
    alert("No se pudo imprimir el cupón por QZ Tray:\n" + (err.message || err));
  }
};
