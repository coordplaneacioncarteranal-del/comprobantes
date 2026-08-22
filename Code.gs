/**
 * ═══════════════════════════════════════════════════════════════════════
 * GOOGLE APPS SCRIPT - BACKEND SERVERLESS CON OCR AUTOMÁTICO (DRIVE API)
 * Portal de Reporte de Pago - Sistema de Conciliación Nequi
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * INSTRUCCIONES DE CONFIGURACIÓN:
 * 
 * 1. Abre Google Drive con la cuenta: coord.planeacioncarteranal@jardinesdelrenacer.co
 * 
 * 2. Hoja de cálculo "Reportes de Pago Nequi":
 *    - SPREADSHEET_ID configurado abajo
 * 
 * 3. Carpeta en Google Drive "Comprobantes de Pago":
 *    - FOLDER_ID configurado abajo
 * 
 * 4. ACTIVAR SERVICIO AVANZADO DE DRIVE (OBLIGATORIO):
 *    - En el menú izquierdo de Apps Script, haz clic en el "+" junto a "Servicios"
 *    - Selecciona "Drive API" y haz clic en "Añadir"
 * 
 * 5. Despliegue como "Web App":
 *    - Ejecutar como: "ño (tu cuenta)"
 *    - Quién tiene acceso: "Cualquier persona" (Anyone)
 * 
 * ═══════════════════════════════════════════════════════════════════════
 */

// 🔧 CONFIGURACIÓN - IDs DE GOOGLE DRIVE ñ SHEETS
const SPREADSHEET_ID = '1fuCH9Dq7yTb80hvoH3CEWU8sRVV87wtLTlJuiscFD5w';
function getFolderId(dondePago) {
  switch(dondePago) {
    case 'Nequi': return '1QljoKKEuPC62LqdRRGamnweR8L3gZJ_V';
    case 'Bancolombia':
    case 'Bancolombia Corresponsal': return '19ToeNy-mGuCKnSNlOCiXvqifDGVh05hi';
    case 'Davivienda':
    case 'Llave Davivienda': return '1dUGQSIiCzCh4mXm_KbOEWVAV0BNMsdO3';
    case 'Efecty': return '1LFGxpF5lK0hzsDNJUZSJflqJ7QM6b-Cñ';
    default: return '1NEd7R_VSfZ2AB8V2l015nilu3t9RAB4k'; // fallback
  }
}

/**
 * Función principal que recibe las peticiones POST desde el frontend
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (!data.nombre || !data.cedula || !data.servicio || !data.contrato || !data.pisco || !data.dondePago || !data.archivo || !data.nombreArchivo) {
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: false, 
          error: 'Faltan datos obligatorios' 
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 1. Guardar el archivo temporalmente en Google Drive
    const archivoDrive = guardarArchivoEnDrive(data.archivo, data.nombreArchivo, data.tipoArchivo, data.cedula, data.dondePago);
    
    // 2. Extraer texto completo del comprobante mediante OCR Nativo
    let textoOCR = '';
    try {
      textoOCR = extraerTextoComprobanteOCR(data.archivo, data.tipoArchivo || 'image/jpeg');
      Logger.log('Texto OCR Reconocido:\n' + textoOCR);
    } catch (ocrError) {
      Logger.log('Aviso en OCR: ' + ocrError.toString());
    }



    // 4. Extracción de Valor, Referencia y Fecha
    const valorExtraido = analizarMontoNequi(textoOCR);
    const referenciaExtraida = extraerReferenciaNequi(textoOCR);
    const fechaExtraida = extraerFechaPago(textoOCR);
    
    Logger.log('Monto: ' + valorExtraido + ' | Ref: ' + referenciaExtraida + ' | Fecha: ' + fechaExtraida);

    // 5. Guardar el registro completo en Google Sheets
    guardarEnSheets({
      nombre: data.nombre,
      cedula: data.cedula,
      servicio: data.servicio,
      valor: valorExtraido,
      referencia: referenciaExtraida,
      fecha: fechaExtraida,
        contrato: data.contrato,
        pisco: data.pisco,
        dondePago: data.dondePago,
      contacto: data.contacto,
      archivoUrl: archivoDrive.url,
      carpetaDrive: archivoDrive.folderName,
      timestamp: data.timestamp
    });
    
    // 6. Retornar éxito
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: true, 
        message: 'Datos guardados y comprobante procesado exitosamente',
        valorDetectado: valorExtraido
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    Logger.log('Error en doPost: ' + error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, 
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Validar que el comprobante contiene el número de Nequi correcto
 */
function validarNequiAutorizado(textoOCR) {
  if (!textoOCR) return false;
  // Limpiar espacios y guiones para buscar el número exacto
  const limpio = textoOCR.replace(/\s/g, '').replace(/-/g, '');
  return limpio.includes('3232516832');
}

/**
 * Extraer la fecha de pago impresa en el comprobante
 */
function extraerFechaPago(textoOCR) {
  if (!textoOCR) return '';
  const limpio = textoOCR.replace(/\r/g, '\n').replace(/\n+/g, ' ');
  
  // 1. Patrón completo tradicional de Nequi: "19 de agosto de 2026 a las 05:09 p. m."
  const matchNequiTradicional = limpio.match(/([0-9]{1,2}\s+de\s+[a-z]+\s+de\s+[0-9]{4}(?:\s+a\s+las\s+[0-9]{1,2}:[0-9]{2}\s*[a-z]\.?\s*m\.?)?)/i);
  if (matchNequiTradicional) return matchNequiTradicional[1].trim();

  // 2. Patrón de Corresponsal Wompi/Bancolombia: "AGO 03 2026 - 16:21:14"
  const matchWompi = limpio.match(/([a-z]{3}\s+[0-9]{1,2}\s+[0-9]{4}\s*-\s*[0-9]{1,2}:[0-9]{2}:[0-9]{2})/i);
  if (matchWompi) return matchWompi[1].trim();

  // 3. Patrón corto Nequi nuevo: "16 Jul 2026 - 06:55 a m." o "16 Jul 2026"
  const matchNequiCorto = limpio.match(/([0-9]{1,2}\s+[a-z]{3}\s+[0-9]{4}(?:\s*-\s*[0-9]{1,2}:[0-9]{2}\s*[a-z]\s*m\.?)?)/i);
  if (matchNequiCorto) return matchNequiCorto[1].trim();

  // 4. Patrón Davivienda: "Jueves 20 agosto, 2026 - 1:52 p. m."
  const matchDavivienda = limpio.match(/([a-z]+[\s,]+[0-9]{1,2}[\s,]+(?:de\s+)?[a-z]+[\s,]+[0-9]{4}\s*-\s*[0-9]{1,2}:[0-9]{2}\s*[a-z]\.?\s*m\.?)/i);
  if (matchDavivienda) return matchDavivienda[1].trim();

  return 'No detectada';
}

/**
 * Realiza OCR sobre la imagen usando el SERVICIO AVANZADO DE DRIVE (Drive API)
 * @param {string} base64Data - Archivo en formato base64
 * @param {string} tipoArchivo - MIME type
 * @return {string} Texto extraído de la imagen
 */
function extraerTextoComprobanteOCR(base64Data, tipoArchivo) {
  let tempDocId = null;
  try {
    let cleanMime = (tipoArchivo || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (cleanMime === 'image/jpg') cleanMime = 'image/jpeg';
    if (!cleanMime.startsWith('image/') && cleanMime !== 'application/pdf') {
      cleanMime = 'image/jpeg';
    }

    const fileBlob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      cleanMime,
      'comprobante_temp'
    );

    // ── MÉTODO: SERVICIO AVANZADO DRIVE API (Rápido y sin límites de cuota) ──
    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.insert) {
      const fileMetadata = {
        title: 'TEMP_OCR_' + new Date().getTime(),
        mimeType: cleanMime
      };
      
      const docFile = Drive.Files.insert(fileMetadata, fileBlob, {
        ocr: true,
        ocrLanguage: 'es'
      });
      
      if (docFile && docFile.id) {
        tempDocId = docFile.id;
        const doc = DocumentApp.openById(tempDocId);
        const text = doc.getBody().getText();
        return text;
      }
    } else {
      Logger.log('ERROR CRÍTICO: El Servicio Avanzado "Drive API" no está activado en Apps Script.');
      return '';
    }
    
    return '';
  } catch (err) {
    Logger.log('Error general en extraerTextoComprobanteOCR: ' + err.toString());
    return '';
  } finally {
    // Eliminar siempre el documento temporal de Google Docs creado para el OCR
    if (tempDocId) {
      try {
        DriveApp.getFileById(tempDocId).setTrashed(true);
      } catch (e) {
        Logger.log('Aviso al limpiar doc temporal: ' + e.toString());
      }
    }
  }
}

/**
 * Analiza el texto OCR y extrae el monto transferido en Nequi
 */
function analizarMontoNequi(textoOCR) {
  if (!textoOCR || textoOCR.trim().length === 0) {
    return 'Pendiente OCR (Comprobante borroso)';
  }

  const limpio = textoOCR.replace(/\r/g, '\n');

  // 1. Patrón característico de Nequi: "¿Cuántoí" seguido del valor
  const patronCuanto = /¿Cu[aá]nto\??[\s\n]*\$?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/i;
  const matchCuanto = limpio.match(patronCuanto);
  if (matchCuanto && matchCuanto[1]) {
    const res = normalizarMontoColombiano(matchCuanto[1]);
    if (res) return res;
  }

  // 2. Patrón de signo pesos con formato de miles
  const patronPesos = /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{2})?|\b[0-9]{4,7}\b)/;
  const matchPesos = limpio.match(patronPesos);
  if (matchPesos && matchPesos[1]) {
    const res = normalizarMontoColombiano(matchPesos[1]);
    if (res) return res;
  }

  // 3. Patrón con palabras clave: "Total", "Valor", "Monto", "Envío", "Exitosa"
  const patronPalabras = /(?:total|valor|monto|env[ií]o|pago|exitosa)[\s:]*\$?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/i;
  const matchPalabras = limpio.match(patronPalabras);
  if (matchPalabras && matchPalabras[1]) {
    const res = normalizarMontoColombiano(matchPalabras[1]);
    if (res) return res;
  }

  return 'Pendiente OCR (Verificar comprobante)';
}

function normalizarMontoColombiano(montoStr) {
  if (!montoStr) return null;
  let clean = montoStr.toString().replace(/\$/g, '').trim();
  clean = clean.replace(/[,.]00$/, '');
  const soloDigitos = clean.replace(/\D/g, '');
  if (!soloDigitos || soloDigitos === '0') return null;
  const num = parseInt(soloDigitos, 10);
  if (num < 1000 || num > 50000000) return null;
  return num; // Return integer instead of formatted string
}

function extraerReferenciaNequi(textoOCR) {
  if (!textoOCR) return '';
  const matchRef = textoOCR.match(/Referencia[\s:]*([A-Za-z0-9]{6,12})/i) || textoOCR.match(/\b(M[0-9]{6,10})\b/);
  return matchRef ? matchRef[1].toUpperCase() : '';
}

/**
 * Guarda el archivo en Google Drive aplicando la nomenclatura estricta por cédula
 */
function guardarArchivoEnDrive(base64Data, nombreArchivo, tipoArchivo, cedula, dondePago) {
  try {
    const folder = DriveApp.getFolderById(getFolderId(dondePago));
    let cleanMime = (tipoArchivo || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (cleanMime === 'image/jpg') cleanMime = 'image/jpeg';
    if (!cleanMime.startsWith('image/') && cleanMime !== 'application/pdf') cleanMime = 'image/jpeg';

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), cleanMime, nombreArchivo);
    const extension = nombreArchivo.split('.').pop() || 'jpeg';
    
    // Contar cuántos comprobantes existen ya con esta cédula
    const files = folder.searchFiles("title contains '" + cedula + "'");
    let count = 0;
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      // Validar si el nombre exacto empieza con la cedula (evitar que "123" cuente en "9123")
      if (name.startsWith(cedula.toString())) {
        count++;
      }
    }
    
    // Si es el primero: 12345.jpeg | Si es el segundo: 12345-2.jpeg
    const suffix = count === 0 ? '' : `-${count + 1}`;
    const nuevoNombre = `${cedula}${suffix}.${extension}`;
    
    const archivo = folder.createFile(blob);
    archivo.setName(nuevoNombre);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return { url: archivo.getUrl(), id: archivo.getId(), folderName: folder.getName() };
  } catch (error) {
    Logger.log('Error al guardar archivo en Drive: ' + error.toString());
    throw new Error('Error al guardar el comprobante en Drive: ' + error.toString());
  }
}

/**
 * Guarda el registro completo en Google Sheets, agregando la nueva columna "Fecha"
 */
function guardarEnSheets(registro) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getActiveSheet();
    
    // Asegurar que existan suficientes columnas físicas en la hoja
    const maxCols = sheet.getMaxColumns();
    if (maxCols < 12) {
      sheet.insertColumnsAfter(maxCols, 12 - maxCols);
    }

    // Asegurar que existan las columnas hasta la 12
    const lastCol = sheet.getLastColumn();
    if (lastCol < 8) sheet.getRange(1, 8).setValue('Fecha del comprobante').setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
    if (lastCol < 9) sheet.getRange(1, 9).setValue('Dónde pagó').setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
    if (lastCol < 10) sheet.getRange(1, 10).setValue('Usuario de pisco').setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
    if (lastCol < 11) sheet.getRange(1, 11).setValue('Número de Contrato').setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
    if (lastCol < 12) sheet.getRange(1, 12).setValue('Ubicación Comprobante').setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
    
    // Si es la primera vez, agregar encabezados iniciales
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
          'Timestamp', 'Nombre completo', 'Cédula', 'Servicio/Producto', 
          'Valor pagado', 'Link del comprobante', 'Estado de conciliación', 'Fecha del comprobante',
          'Dónde pagó', 'Usuario de pisco', 'Número de Contrato', 'Ubicación Comprobante'
        ]);
      sheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#f093fb').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    
    const timestampFormateado = Utilities.formatDate(new Date(registro.timestamp), 'GMT-5', 'dd/MM/yyyy HH:mm:ss');
    let valorFinal = registro.valor || 'Pendiente OCR';
    if (registro.referencia && valorFinal !== 'Pendiente OCR') {
      valorFinal = `$ ${Number(valorFinal).toLocaleString('es-CO')} (Ref: ${registro.referencia})`;
    }

    const rowData = [
      timestampFormateado, 
      registro.nombre, 
      registro.cedula, 
      registro.servicio,
      valorFinal, 
      registro.archivoUrl, 
      'Pendiente de verificar', 
      registro.fecha || 'No detectada',
      registro.dondePago || '',
      registro.pisco || '',
      registro.contrato || '',
      registro.carpetaDrive || ''
    ];

    // Buscar la última fila real basándonos en la columna A (Timestamp)
    const colA = sheet.getRange("A:A").getValues();
    let trueLastRow = 0;
    for (let i = colA.length - 1; i >= 0; i--) {
      if (colA[i][0] && colA[i][0].toString().trim() !== '') {
        trueLastRow = i + 1;
        break;
      }
    }
    
    const lastRow = trueLastRow + 1;
    sheet.getRange(lastRow, 1, 1, rowData.length).setValues([rowData]);
    
    // Estilos alternos de fila
    if (lastRow % 2 === 0) {
      sheet.getRange(lastRow, 1, 1, rowData.length).setBackground('#f9fafb');
    }
    
    // Formato de Celda de Valor
    const valorCell = sheet.getRange(lastRow, 5);
    valorCell.setFontWeight('bold');
    if (String(valorFinal).includes('Pendiente')) {
      valorCell.setFontColor('#b45309').setBackground('#fef3c7');
    } else {
      valorCell.setFontColor('#065f46').setBackground('#ecfdf5').setNumberFormat('"$" #,##0');
    }

    // Formato Enlace
    sheet.getRange(lastRow, 6).setFontColor('#0066cc').setFontLine('underline');
    
    // Formato Estado
    sheet.getRange(lastRow, 7).setBackground('#fef3c7').setFontColor('#92400e').setFontWeight('bold');
    
    // Formato Fecha OCR
    sheet.getRange(lastRow, 8).setFontColor('#4b5563');
    
    // Formato Número de Contrato
    sheet.getRange(lastRow, 11).setFontColor('#4b5563');
    
  } catch (error) {
    Logger.log('Error al guardar en Sheets: ' + error.toString());
    throw new Error('Error al guardar en Sheets: ' + error.toString());
  }
}
/**
 * Crea un menú personalizado en Google Sheets al abrir el documento.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Actualizar Datos')
      .addItem('Actualizar Ubicación de Comprobantes', 'actualizarUbicaciones')
      .addToUi();
}

/**
 * Revisa todos los enlaces de comprobantes y actualiza la columna 12 (Ubicación Comprobante)
 * con el nombre de la carpeta actual donde se encuentra el archivo en Drive.
 */
function actualizarUbicaciones() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  
  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert('Aviso', 'No hay datos para actualizar.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  
  // Mostrar mensaje de inicio (opcional, pero útil)
  SpreadsheetApp.getActiveSpreadsheet().toast('Buscando ubicaciones...', 'Actualizando', 3);
  
  // Columna 6 = Link, Columna 12 = Ubicación
  const dataRange = sheet.getRange(2, 6, lastRow - 1, 7); 
  const data = dataRange.getValues();
  
  let actualizados = 0;
  let conErrores = 0;
  
  for (let i = 0; i < data.length; i++) {
    const link = data[i][0]; // Columna 6 (índice 0)
    if (link && link.toString().includes('drive.google.com/file/d/')) {
      const match = link.toString().match(/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const fileId = match[1];
        try {
          const file = DriveApp.getFileById(fileId);
          const parents = file.getParents();
          if (parents.hasNext()) {
            const folderName = parents.next().getName();
            // Columna 12 (índice 6)
            if (data[i][6] !== folderName) {
              data[i][6] = folderName;
              actualizados++;
            }
          }
        } catch (e) {
          conErrores++;
        }
      }
    }
  }
  
  if (actualizados > 0) {
    const nuevasUbicaciones = data.map(row => [row[6]]);
    sheet.getRange(2, 12, lastRow - 1, 1).setValues(nuevasUbicaciones);
    SpreadsheetApp.getUi().alert('Éxito', "Se han actualizado " + actualizados + " ubicaciones de comprobantes correctamente.\n(Errores/No encontrados: " + conErrores + ")", SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    SpreadsheetApp.getUi().alert('Finalizado', "Todas las ubicaciones ya estaban al día.\n(Errores/No encontrados: " + conErrores + ")", SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
