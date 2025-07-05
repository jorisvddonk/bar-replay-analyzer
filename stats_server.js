const net = require('net');

// Create a TCP server
const server = net.createServer((socket) => {
    // Log when a new client connects
    console.log(`--Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
    
    // Set the encoding for incoming data (optional)
    socket.setEncoding('utf8');
    
    // Handle incoming data
    socket.on('data', (data) => {
        //console.log(`--Received data from ${socket.remoteAddress}:${socket.remotePort}:`);
        // write without newline
        process.stdout.write(data.toString());
        
        // If you want to see hex dump (useful for binary data):
        // console.log(data.toString('hex'));
    });
    
    // Handle client disconnection
    socket.on('end', () => {
        console.log(`--Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
    });
    
    // Handle errors
    socket.on('error', (err) => {
        console.error(`--Socket error with ${socket.remoteAddress}:${socket.remotePort}:`, err);
    });
});

// Handle server errors
server.on('error', (err) => {
    console.error('--Server error:', err);
});

// Start listening on port 12406
server.listen(12406, () => {
    console.log('--TCP server listening on port 12406');
});