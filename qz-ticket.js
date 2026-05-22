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

    let printerName = null;

    // 1) Prioridad: Epson TM
    printerName = printers.find(p =>
      String(p).toUpperCase().includes("EPSON") &&
      String(p).toUpperCase().includes("TM")
    );

    // 2) Si no encuentra Epson, busca POS-80C
    if (!printerName) {
      printerName = printers.find(p =>
        String(p).toUpperCase().includes("POS-80C")
      );
    }

    if (!printerName) {
      alert(
        "No encontré impresora térmica.\n\n" +
        printers.join("\n")
      );
      return;
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