const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store lobbies in memory
const lobbies = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Host creates a lobby
    socket.on('host-lobby', () => {
        const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        lobbies[lobbyCode] = {
            hostId: socket.id,
            members: [{ id: socket.id, name: 'Host', ready: false }],
            photos: [],
            status: 'waiting'
        };
        socket.join(lobbyCode);
        socket.emit('lobby-created', { lobbyCode });
        io.to(lobbyCode).emit('lobby-update', {
            members: lobbies[lobbyCode].members,
            count: lobbies[lobbyCode].members.length,
            max: 4
        });
    });

    // Join existing lobby
    socket.on('join-lobby', ({ lobbyCode }) => {
        const lobby = lobbies[lobbyCode];
        if (lobby && lobby.members.length < 4 && lobby.status === 'waiting') {
            lobby.members.push({ id: socket.id, name: `Guest ${lobby.members.length}`, ready: false });
            socket.join(lobbyCode);
            socket.emit('lobby-joined', { lobbyCode });
            io.to(lobbyCode).emit('lobby-update', {
                members: lobby.members,
                count: lobby.members.length,
                max: 4
            });
        } else {
            socket.emit('error-message', { message: 'Lobby not found or full' });
        }
    });

    // Enable microphone
    socket.on('enable-mic', () => {
        socket.broadcast.to(socket.rooms).emit('user-audio-enabled', { userId: socket.id });
    });

    // Host starts photobooth
    socket.on('start-photobooth', ({ lobbyCode }) => {
        const lobby = lobbies[lobbyCode];
        if (lobby && lobby.hostId === socket.id) {
            lobby.status = 'capturing';
            io.to(lobbyCode).emit('photobooth-started');
            
            // Capture 4 photos with countdown
            let photoCount = 0;
            const captureInterval = setInterval(() => {
                photoCount++;
                io.to(lobbyCode).emit('capture-photo', { photoNumber: photoCount });
                
                if (photoCount >= 4) {
                    clearInterval(captureInterval);
                    lobby.status = 'processing';
                    io.to(lobbyCode).emit('photos-captured');
                }
            }, 3500); // 3.5 seconds between photos
        }
    });

    // Submit captured photo
    socket.on('submit-photo', ({ lobbyCode, photoData, photoNumber }) => {
        const lobby = lobbies[lobbyCode];
        if (lobby) {
            if (!lobby.photos[photoNumber - 1]) {
                lobby.photos[photoNumber - 1] = [];
            }
            lobby.photos[photoNumber - 1].push({ userId: socket.id, data: photoData });
            
            // Check if all members submitted this photo
            if (lobby.photos[photoNumber - 1].length === lobby.members.length) {
                socket.to(lobbyCode).emit('photo-received', { photoNumber });
                if (photoNumber === 4) {
                    io.to(lobbyCode).emit('ready-for-processing');
                }
            }
        }
    });

    // Apply frame theme
    socket.on('apply-frame', ({ lobbyCode, theme }) => {
        const lobby = lobbies[lobbyCode];
        if (lobby) {
            io.to(lobbyCode).emit('frame-applied', { theme, photos: lobby.photos });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const [lobbyCode, lobby] of Object.entries(lobbies)) {
            const memberIndex = lobby.members.findIndex(m => m.id === socket.id);
            if (memberIndex !== -1) {
                lobby.members.splice(memberIndex, 1);
                io.to(lobbyCode).emit('lobby-update', {
                    members: lobby.members,
                    count: lobby.members.length,
                    max: 4
                });
                
                if (lobby.members.length === 0) {
                    delete lobbies[lobbyCode];
                } else if (lobby.hostId === socket.id && lobby.members.length > 0) {
                    // Transfer host to first remaining member
                    lobby.hostId = lobby.members[0].id;
                    io.to(lobbyCode).emit('host-transferred', { newHostId: lobby.hostId });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
