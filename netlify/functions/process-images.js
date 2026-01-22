const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

exports.handler = async (event) => {
  console.log('🚀 Function started');
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const tmpDir = '/tmp';
  const inputDir = path.join(tmpDir, `input-${Date.now()}`);
  const outputDir = path.join(tmpDir, `output-${Date.now()}`);

  try {
    // Vérifier les headers
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    console.log('📦 Content-Type:', contentType);
    
    if (!contentType || !contentType.includes('multipart/form-data')) {
      throw new Error('Content-Type must be multipart/form-data');
    }

    // Extraire le boundary
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      throw new Error('No boundary found in Content-Type');
    }
    const boundary = boundaryMatch[1];
    console.log('🔍 Boundary:', boundary);

    // Parser le body
    const bodyBuffer = Buffer.from(event.body, 'base64');
    const parts = parseMultipart(bodyBuffer, boundary);
    console.log(`📦 Parsed ${parts.length} file(s)`);

    if (parts.length === 0) {
      throw new Error('No files uploaded');
    }

    // Créer le dossier input
    await fs.mkdir(inputDir, { recursive: true });
    console.log('📁 Input dir created:', inputDir);

    // Extraire les fichiers
    for (const part of parts) {
      if (part.filename) {
        const filePath = path.join(inputDir, part.filename);
        console.log('💾 Processing file:', part.filename);
        
        if (part.filename.endsWith('.zip')) {
          console.log('📂 Extracting ZIP...');
          const zip = new AdmZip(part.data);
          zip.extractAllTo(inputDir, true);
        } else {
          await fs.writeFile(filePath, part.data);
        }
      }
    }

    // Créer le dossier output
    await fs.mkdir(outputDir, { recursive: true });
    console.log('📁 Output dir created:', outputDir);

    // Générer les images
    console.log('🖼️ Starting image generation...');
    await generateImages(inputDir, outputDir);

    // Créer le ZIP de sortie
    console.log('📦 Creating output ZIP...');
    const outputZip = new AdmZip();
    await addDirectoryToZip(outputZip, outputDir, '');
    const zipBuffer = outputZip.toBuffer();
    console.log('✅ ZIP created, size:', zipBuffer.length, 'bytes');

    // Cleanup
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    console.log('🧹 Cleanup done');

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
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);

    // Cleanup on error
    try {
      await fs.rm(inputDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Erreur: ${error.message}\n\nStack: ${error.stack}`
    };
  }
};

// Parse multipart form data
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const sections = [];

  let start = 0;
  while (true) {
    const pos = buffer.indexOf(boundaryBuffer, start);
    if (pos === -1) break;
    if (start !== 0) {
      sections.push(buffer.slice(start, pos));
    }
    start = pos + boundaryBuffer.length;
  }

  for (const section of sections) {
    const headerEnd = section.indexOf(Buffer.from('\r\n\r\n'));
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

// Add directory to ZIP recursively
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

// Generate images - UN DOSSIER PAR IMAGE avec naming @1x, @2x, @3x, @4x
async function generateImages(inputDir, outputDir) {
  // Read images
  const files = await fs.readdir(inputDir);
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));

  console.log(`📷 Found ${imageFiles.length} image(s)`);

  if (imageFiles.length === 0) {
    throw new Error('No images found in uploaded files');
  }

  // Sizes avec nouveau naming @1x, @2x, @3x, @4x
  const sizes = [
    { width: 480, suffix: '@1x', label: 'mobile' },
    { width: 768, suffix: '@2x', label: 'tablet' },
    { width: 1280, suffix: '@3x', label: 'desktop' },
    { width: 1920, suffix: '@4x', label: 'large desktop' }
  ];

  // Generate variations - UN DOSSIER PAR IMAGE
  for (const file of imageFiles) {
    const inputPath = path.join(inputDir, file);
    const basename = path.parse(file).name;

    // Créer un dossier pour cette image
    const imageFolderPath = path.join(outputDir, basename);
    await fs.mkdir(imageFolderPath, { recursive: true });
    console.log(`📁 Creating folder: ${basename}/`);

    // Générer les 4 tailles dans ce dossier
    for (const size of sizes) {
      const outputPath = path.join(imageFolderPath, `${basename}${size.suffix}.webp`);

      await sharp(inputPath)
        .resize(size.width, null, { withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: 85 })
        .toFile(outputPath);
      
      console.log(`  ✓ ${basename}${size.suffix}.webp (${size.width}px - ${size.label})`);
    }

    console.log(`✅ ${file} → 4 sizes generated`);
  }

  console.log(`🎉 Total: ${imageFiles.length} folders with ${sizes.length} sizes each`);
}