window.imprimirTicketQZ = async function (html) {
  try {
    if (!window.qz) {
      alert("QZ Tray no está cargado. Revisá que qz-tray.js haya cargado correctamente.");
      return;
    }

    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }

    const printerName = window.QZ_TICKET_PRINTER || "POS-80C";

    const config = qz.configs.create(printerName, {
      units: "mm",
      size: { width: 80, height: 120 },
      margins: 0,
      scaleContent: true
    });

    const contenido =
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="UTF-8">' +
      '<style>' +
      'html,body{margin:0;padding:0;width:80mm;background:#fff;font-family:Arial,sans-serif;color:#000;}' +
      '.ticket-80{width:72mm;margin:0 auto;padding:4mm;box-sizing:border-box;font-family:Arial,sans-serif;color:#000;font-size:12px;}' +
      '*{box-sizing:border-box;}' +
      '</style>' +
      '</head>' +
      '<body>' +
      html +
      '</body>' +
      '</html>';

    const data = [{
      type: "pixel",
      format: "html",
      flavor: "plain",
      data: contenido
    }];

    await qz.print(config, data);

  } catch (err) {
    console.error(err);
    alert("No se pudo imprimir el cupón por QZ Tray: " + (err && err.message ? err.message : err));
  }
};
