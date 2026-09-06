const fs = require("fs-extra");
const iconv = require('iconv-lite');
const path = require("path");
const seven7z = require("node-7z");
const ZipReader = require("./ZipReader.js");
const { execFileSync } = require("node:child_process");

const convertImageToBase64 = (filePath, imageExt = "png") => {
    try {
        const pngBuffer = fs.readFileSync(filePath);
        // Только данные картинки
        const base64String = Buffer.from(pngBuffer).toString("base64");
        // С заголовком
        // const dataUriString = `data:image/${imageExt};base64,${base64String}`;

        return base64String;
    } catch (error) {
        console.error(`Error converting file to Base64: ${error.message}`);
        throw error;
    }
};

function isJxlBuffer(buffer) {
    // JXL сигнатура: первые 2 байта: 0xFF 0x0A
    return buffer.length > 2 &&
        buffer[0] === 0xFF &&
        buffer[1] === 0x0A;
}

function isPngBuffer(buffer) {
    //  PNG сигнатура: 89 50 4E 47 0D 0A 1A 0A
    return buffer.length > 2 && buffer[0] === 0x89 && buffer[1] === 0x50
}

function isJpgBuffer(buffer) {
    //  JPG сигнатура: FF D8
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8
}


async function jxlConvert(imageBuff, pathTmp, namefile) {
    let ext = "png"
    let outputImg = `${pathTmp}/${namefile}.${ext}`;

    if (isJxlBuffer(imageBuff)) {
        execFileSync("djxl", ["--bits_per_sample=8", "-", outputImg], {
            input: imageBuff,
            maxBuffer: 50 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe']
        });

    } else {
        if (isJpgBuffer(imageBuff)) {
            ext = "jpeg"
            outputImg = `${pathTmp}/${namefile}.jpg`;
        }

        fs.writeFileSync(outputImg, imageBuff, {
            flag: "w",
        })
    }

    return { outputImg, ext }
}

async function getCoverBufferFromZip(pathCover, bookId) {
    const zipReader = new ZipReader();

    try {
        await zipReader.open(pathCover);
        if (bookId in zipReader.zipEntries) {
            return await zipReader.extractToBuf(bookId);
        }

    } catch (e) {
        console.error(e);
        return null;
    } finally {
        zipReader.close();
    }
}

async function getCoverByBookId(config, libFolder, bookId, pathTmp) {
    const pathCover = path.join(config.libDir, "covers", libFolder);
    if (!await fs.pathExists(pathCover)) {
        console.log(`❌ Error path to coverpage "${pathCover}" not found!`);
        return null
    }

    const coverBuff = await getCoverBufferFromZip(pathCover, bookId)
    if (!coverBuff) {
        console.log(`❌ Cover buffer data is incorrect!`)
        return null
    }

    return await jxlConvert(coverBuff, pathTmp, `${bookId}_cover`)
}


async function getImagesBase64(config, libFolder, fileName) {
    const pathImages = path.join(config.libDir, "images", libFolder);
    if (!(await fs.pathExists(pathImages))) {
        console.log(`❌ Error path to illustrations "${pathImages}" not found!`);
        return;
    }

    let obj_images = {};
    const bookId = fileName.replace(".fb2", "");
    const pathTmp = `${config.tempDir}/${bookId}`;

    if (!fs.pathExistsSync(pathTmp))
        fs.mkdirSync(pathTmp);


    // Get cover
    const cover_obj = await getCoverByBookId(config, libFolder, bookId, pathTmp)
    if (cover_obj) {
        const { outputImg, ext } = cover_obj
        obj_images["cover"] = convertImageToBase64(outputImg, ext)
    } else {
        console.log(`❌ Error coverpage equal null!`);
    }

    // Get illustrations    
    const zipReader = new ZipReader();
    try {
        await zipReader.open(pathImages);

        for (const entry of Object.values(zipReader.zipEntries)) {
            if (entry.name.includes(bookId)) {
                const imageBuff = await zipReader.extractToBuf(entry.name);
                const namefile = entry.name.slice(entry.name.lastIndexOf("/") + 1);

                const { outputImg, ext } = await jxlConvert(imageBuff, pathTmp, namefile)
                obj_images[namefile] = convertImageToBase64(outputImg, ext);
            }
        }

        if (fs.pathExistsSync(pathTmp))
            fs.rmdirSync(pathTmp, { recursive: true });


    } catch (e) {
        console.error(e);
    } finally {
        zipReader.close();
    }

    return obj_images;
}

async function extractFrom7z(config, arhivePath, libFolder, fileName, outFile) {
    return new Promise((resolve, reject) => {
        const stream = seven7z.extractFull(arhivePath, config.tempDir, {
            $cherryPick: fileName,
            recursive: true,
        });

        stream.on("end", async (e) => {
            const extractedPath = `${config.tempDir}/${fileName}`;

            const rawBuffer = await fs.readFile(extractedPath);
            
            // Определяем кодировку
            const preview = rawBuffer.slice(0, 500).toString("ascii");
            const match = preview.match(/encoding=["']([^"']+)["']/i);
            const encoding = match ? match[1].toLowerCase() : "windows-1251"; 

            let fb2Text = iconv.decode(rawBuffer, encoding);
            
            // Чистый Base64 (без заголовка "data:image/png;base64,")
            const entries = await getImagesBase64(config, libFolder, fileName);

            // Генерируем блоки <binary> для вставки в конец файла
            let binaryBlocks = "";
            for (const imageName in entries) {
                const pureBase64 = entries[imageName].replace(/^data:image\/\w+;base64,/, "");
                
                // Определяем тип контента (png или jpeg)
                const contentType = imageName.toLowerCase().endsWith(".jpg") || imageName.toLowerCase().endsWith(".jpeg") 
                    ? "image/jpeg" 
                    : "image/png";

                binaryBlocks += `\n<binary id="${imageName}" content-type="${contentType}">${pureBase64}</binary>`;
            }

            // Вставляем блоки <binary>
            if (fb2Text.includes("</FictionBook>")) {
                fb2Text = fb2Text.replace("</FictionBook>", `${binaryBlocks}\n</FictionBook>`);
            } else {
                fb2Text += binaryBlocks;
            }

            // Сохраняем в UTF-8
            fb2Text = fb2Text.replace(/encoding=["']([^"']+)["']/i, 'encoding="utf-8"');

            await fs.writeFile(extractedPath, fb2Text, "utf-8");

            fs.move(extractedPath, outFile, { overwrite: true })
                .then(() => resolve())
                .catch(reject);
        });


        stream.on("error", reject);
    });
}

async function Fb2AppendImages(config, libFolder, fileName, outFile) {
    const path7z = `${config.libDir}/${libFolder}`.replace(".zip", ".7z");
    if (!(await fs.pathExists(path7z))) {
        console.log(`❌ Path to 7z "${path7z}" not found!`);
        return;
    }

    // Start get fb2 with illustrations images
    await extractFrom7z(config, path7z, libFolder, fileName, outFile);
}

module.exports = Fb2AppendImages;
