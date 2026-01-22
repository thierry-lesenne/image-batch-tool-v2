const { Buffer } = require('buffer');
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  const tmpDir = '/tmp';
  const inputDir = path.join(tmpDir, `input-${Date.now()}`);
  const outputDir = path.join(tmpDir, `output-${Date.now()}`);

  try {
    console.log('🚀 Function started');

    // Parse multipart form data
    const boundary = event.headers['content-type'].split('boundary=')[1];
    const parts = parseMultipart(Buffer.from(event.body, 'base64'), boundary);

    console.log(`📦 Received ${parts.length} files`);

    // Create input directory
    await fs.mkdir(inputDir, { recursive: true });

    // Extract files
    for (const part of parts) {
      if (part.filename) {
        const filePath = path.join(inputDir, part.filename);
        
        // If ZIP, extract it
        if (part.filename.endsWith('.zip')) {
          console.log(`📂 Extracting ZIP: ${part.filename}`);
          const zip = new AdmZip(part.data);
          zip.extractAllTo(inputDir, true);
        } else {
          console.log(`💾 Saving file: ${part.filename}`);
          await fs.writeFile(filePath, part.data);
        }
      }
    }

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Execute image generation
    console.log('🖼️ Starting image generation...');
    await generateImages(inputDir, outputDir);

    // Create output ZIP
    console.log('📦 Creating output ZIP...');
    const outputZip = new AdmZip();
    await addDirectoryToZip(outputZip, outputDir, '');

    const zipBuffer = outputZip.toBuffer();

    // Cleanup
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });

    console.log('✅ Success');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="diag360-images.zip"'
      },
      body: zipBuffer.toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    console.error('❌ Error:', error);

    // Cleanup on error
    try {
      await fs.rm(inputDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {}

    return {
      statusCode: 500,
      body: `Erreur : ${error.message}`
    };
  }
};

// Helper: Parse multipart form data
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  const sections = [];

  let start = 0;
  while (true) {
    const pos = buffer.indexOf(delimiter, start);
    if (pos === -1) break;
    if (start !== 0) {
      sections.push(buffer.slice(start, pos));
    }
    start = pos + delimiter.length;
  }

  for (const section of sections) {
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = section.slice(0, headerEnd).toString();
    const data = section.slice(headerEnd + 4, section.length - 2);

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      parts.push({
        filename: filenameMatch[1],
        data: data
      });
    }
  }

  return parts;
}

// Helper: Add directory to ZIP recursively
async function addDirectoryToZip(zip, dirPath, zipPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, zipEntryPath);
    } else {
      const content = await fs.readFile(fullPath);
      zip.addFile(zipEntryPath, content);
    }
  }
}

// Image generation function
async function generateImages(inputDir, outputDir) {
  const folders = [
    'hero',
    'features', 
    'gallery',
    'thumbnails',
    'backgrounds',
    'icons',
    'misc'
  ];

  // Create folders
  for (const folder of folders) {
    await fs.mkdir(path.join(outputDir, folder), { recursive: true });
  }

  // Read images
  const files = await fs.readdir(inputDir);
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));

  console.log(`📷 Found ${imageFiles.length} images`);

  if (imageFiles.length === 0) {
    throw new Error('Aucune image trouvée');
  }

  // Sizes
  const sizes = [
    { width: 1920, suffix: '-xl' },
    { width: 1280, suffix: '-lg' },
    { width: 768, suffix: '-md' },
    { width: 480, suffix: '-sm' }
  ];

  // Generate variations
  for (const file of imageFiles) {
    const inputPath = path.join(inputDir, file);
    const basename = path.parse(file).name;

    for (const folder of folders) {
      for (const size of sizes) {
        const outputPath = path.join(
          outputDir,
          folder,
          `${basename}${size.suffix}.webp`
        );

        try {
          await sharp(inputPath)
            .resize(size.width, null, {
              withoutEnlargement: true,
              fit: 'inside'
            })
            .webp({ quality: 85 })
            .toFile(outputPath);
        } catch (err) {
          console.error(`⚠️ Error on ${outputPath}:`, err.message);
        }
      }
    }

    console.log(`✅ ${file} processed`);
  }
}