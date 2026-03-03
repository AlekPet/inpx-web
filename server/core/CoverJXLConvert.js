const fs = require("fs-extra");
const path = require("path");
const ZipReader  = require("./ZipReader.js");
// const sharp  = require("sharp");
const { execSync } = require('node:child_process');

// -- @jsquash/jxl
// -- Использование @jsquash/jxl (не удается скомипилировать в bytecode, запускается и работает!)
// -- Необходима библиотека jxl и sharp (стандартная jxl/jpeg, не конвертирует): npm install @jsquash/jxl sharp
// async function initJXL(){
//   // eslint-disable-next-line no-undef
//   const originalFetch = globalThis.fetch;

//   // Загружаем WASM заранее
//   const wasmPathDec = "node_modules/@jsquash/jxl/codec/dec/jxl_dec.wasm";

//   console.log("Загрузка WASM из:", wasmPathDec);
//   const wasmBuffer = await fs.readFile(wasmPathDec);
//   const wasmArray = new Uint8Array(wasmBuffer);

//   // Создаем правильный Response объект
//   const wasmResponse = new Response(wasmArray, {
//     status: 200,
//     statusText: "OK",
//     headers: new Headers({
//       "Content-Type": "application/wasm",
//       "Content-Length": wasmArray.length.toString(),
//     }),
//   });


//   // Подменяем fetch
//   // eslint-disable-next-line no-undef
//   globalThis.fetch = async(url, init) => {
//     const urlStr = url.toString();
//     console.log("Перехват запроса:", urlStr);

//     if (urlStr.includes("jxl_dec.wasm")) {
//       console.log("✅ Возвращаем предзагруженный WASM ответ");
//       // Возвращаем клон, так как response может быть использован несколько раз
//       return wasmResponse.clone();
//     }

//     console.log("⏩ Возвращаем оригинальный fetch:", urlStr);
//     return originalFetch(url, init);
//   };

//   try {
//     console.log("Импортирование JXL декодера...");
//     const { default: decode, init: initDecode } =
//       await import("@jsquash/jxl/decode.js");


//     console.log("Инициалиазция декодера...");
//     await initDecode();

//     console.log("✅ JXL декодер успешно инициализирован");

//     // Восстанавливаем оригинальный fetch
//     // eslint-disable-next-line no-undef
//     globalThis.fetch = originalFetch;

//     return decode
//       } catch (error) {
//     // eslint-disable-next-line no-undef
//     globalThis.fetch = originalFetch;
//     throw new Error(`❌ Ошибка загрузки декодера JXL: ${error}`);
//   }
// }


// async function extractZipCoverAndConvert(config, hash, bookFile, entryBook, ext=".jpg") {

//   try {
//     const decode = await initJXL();
//     const pathCover = path.join(config.libDir, "covers", bookFile);

//     if(!await fs.pathExists(pathCover)){
//       throw new Error("❌ Путь для обложки книги не найден!")
//     }

//     const imageJXLBuffer = await getCoverBuff(pathCover, entryBook);
//     if(!imageJXLBuffer){
//       throw new Error("❌ Не верные данные буфера JXL изображения!")
//     }

//     const outputImage = path.join(config.bookDir, `${hash}${ext}`);

//     // Декодирование
//     const jxlArrayBuffer = imageJXLBuffer.buffer.slice(
//       imageJXLBuffer.byteOffset,
//       imageJXLBuffer.byteOffset + imageJXLBuffer.byteLength,
//     );

//     console.log("Декодируем JXL изображение...");
//     const imageData = await decode(jxlArrayBuffer);

//     console.log("✅ Декодирование завершено успешно:", {
//       width: imageData.width,
//       height: imageData.height,
//       dataLength: imageData.data.length,
//     });

//     await sharp(imageData.data, {
//       raw: {
//         width: imageData.width,
//         height: imageData.height,
//         channels: 4, // RGBA - 4 канала
//       },
//     })
//       .jpeg()
//       .toFile(outputImage);
//     console.log(`✅ Изображение успешно сохранено: ${outputImage}`);
//     return outputImage
//   } catch (error) {
//     throw new Error(`❌ Ошибка: ${error}`);
//   }
// }

async function getCoverBuff(pathCover, entryBook) {
  const zipReader = new ZipReader();

  try {
    await zipReader.open(pathCover);

    if (entryBook in zipReader.entries) 
      return await zipReader.extractToBuf(entryBook);
    
  } catch (e) {
    console.error(e);
    return null;
  } finally {
    zipReader.close();
  }
}

// -- Альтернативный вариант использовать библиотеку: https://github.com/libjxl/libjxl
// -- Необходимо расположить исполняемый файл djxl рядом с исполняемым файлом inpx-web,
// -- или добавить путь к djxl глобально в переменную среды.
async function extractZipCoverAndConvert(config, hash, bookFile, entryBook, ext=".png") {
  try {
    const pathCover = path.join(config.libDir, "covers", bookFile);
    
    if(!await fs.pathExists(pathCover)){
      console.log(`❌ Book "${bookFile}" cover not found!`)
      return null
    }

    const imageBuffer = await getCoverBuff(pathCover, entryBook);
    if(!imageBuffer){
      console.log(`❌ Cover buffer data is incorrect!`)
      return null
    }

    const outputImage = path.join(config.bookDir, `${hash}${ext}`);

    const output = execSync(`djxl - "${outputImage}"`, {
      input: imageBuffer,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    }).toString();
    console.log(`Output: ${output}`);

    return `${config.bookPathStatic}/${hash}${ext}`
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null
  }
}

module.exports = extractZipCoverAndConvert;