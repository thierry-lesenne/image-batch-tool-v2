exports.handler = async (event) => {
  try {
    console.log('✅ Test function started');
    
    // Test 1: Basic function works
    const test1 = { message: 'Function works!' };
    console.log('✅ Test 1 passed');
    
    // Test 2: Can require Sharp
    const sharp = require('sharp');
    console.log('✅ Test 2 passed - Sharp loaded');
    
    // Test 3: Sharp version
    const version = sharp.versions;
    console.log('✅ Sharp version:', version);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        sharp: version,
        message: 'All tests passed!'
      })
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
};