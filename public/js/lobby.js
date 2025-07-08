// Lobby functionality for Exploding Kittens

class LobbyManager {
    constructor() {
        this.socket = null;
        this.playerName = '';
        this.playerId = '';
        this.init();
    }

    init() {
        this.setupSocketConnection();
        this.setupEventListeners();
        this.checkExistingPlayer();
    }

    checkExistingPlayer() {
        // Check if we have stored player information
        const storedPlayerName = sessionStorage.getItem('playerName');
        const storedPlayerId = sessionStorage.getItem('playerId');
        
        if (storedPlayerName && storedPlayerId) {
            // Auto-join lobby with existing credentials
            this.playerName = storedPlayerName;
            this.playerId = storedPlayerId;
            
            this.showLoading('Reconnecting...');
            
            this.socket.emit('join-lobby', { 
                playerName: this.playerName,
                playerId: this.playerId
            });
        } else {
            // Show name setup for new users
            this.showNameSetup();
        }
    }

    setupSocketConnection() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.hideLoading();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.showStatus('Disconnected from server', 'error');
        });

        this.socket.on('lobby-joined', (data) => {
            if (data.success) {
                this.playerId = data.playerId;
                this.playerName = data.playerName;
                
                // Store persistent player ID
                sessionStorage.setItem('playerId', this.playerId);
                sessionStorage.setItem('playerName', this.playerName);
                
                this.hideLoading();
                this.showLobby();
                this.refreshRooms();
                
                console.log(`Joined lobby with persistent ID: ${this.playerId}`);
            }
        });

        this.socket.on('room-created', (data) => {
            if (data.success) {
                this.showStatus('Room created successfully!', 'success');
                
                // Store room info for navigation
                sessionStorage.setItem('roomId', data.roomId);
                
                this.navigateToGame(data.roomId);
            }
        });

        this.socket.on('room-joined-success', (data) => {
            if (data.success) {
                const message = data.reconnected ? 'Reconnected to room successfully!' : 'Joined room successfully!';
                this.showStatus(message, 'success');
                
                // Store room info for navigation
                sessionStorage.setItem('roomId', data.roomId);
                
                this.navigateToGame(data.roomId);
            }
        });

        this.socket.on('error', (data) => {
            this.showStatus(data.message, 'error');
            this.hideLoading();
        });

        // Handle connection errors
        this.socket.on('connect_error', () => {
            this.showStatus('Failed to connect to server', 'error');
            this.hideLoading();
        });
    }

    setupEventListeners() {
        // Name setup
        const nameInput = document.getElementById('player-name');
        const setNameBtn = document.getElementById('set-name-btn');

        setNameBtn.addEventListener('click', () => this.setPlayerName());
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.setPlayerName();
        });

        // Change name
        const changeNameBtn = document.getElementById('change-name-btn');
        const newNameInput = document.getElementById('new-player-name');

        changeNameBtn.addEventListener('click', () => this.changePlayerName());
        newNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.changePlayerName();
        });

        const createRoomBtn = document.getElementById('create-room-btn');
        createRoomBtn.addEventListener('click', () => this.createRoom());

        // Room joining
        const joinRoomBtn = document.getElementById('join-room-btn');
        const roomCodeInput = document.getElementById('room-code');

        joinRoomBtn.addEventListener('click', () => this.joinRoom());
        roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        // Room refresh
        const refreshBtn = document.getElementById('refresh-rooms-btn');
        refreshBtn.addEventListener('click', () => this.refreshRooms());

        // Status message close
        const closeStatusBtn = document.getElementById('close-status');
        closeStatusBtn.addEventListener('click', () => this.hideStatus());

        // Auto-refresh rooms every 10 seconds
        setInterval(() => {
            if (this.isLobbyVisible()) {
                this.refreshRooms();
            }
        }, 10000);
    }

    setPlayerName() {
        const nameInput = document.getElementById('player-name');
        const name = nameInput.value.trim();

        if (!name) {
            this.showStatus('Please enter your name', 'error');
            return;
        }

        if (name.length > 20) {
            this.showStatus('Name must be 20 characters or less', 'error');
            return;
        }

        this.showLoading('Joining lobby...');
        
        // Check if we have an existing player ID (for reconnection)
        const existingPlayerId = sessionStorage.getItem('playerId');
        
        this.socket.emit('join-lobby', { 
            playerName: name,
            playerId: existingPlayerId
        });
    }

    changePlayerName() {
        const newNameInput = document.getElementById('new-player-name');
        const newName = newNameInput.value.trim();

        if (!newName) {
            this.showStatus('Please enter a new name', 'error');
            return;
        }

        if (newName.length > 20) {
            this.showStatus('Name must be 20 characters or less', 'error');
            return;
        }

        this.playerName = newName;
        sessionStorage.setItem('playerName', this.playerName);
        document.getElementById('display-name').textContent = this.playerName;
        this.showStatus('Name changed successfully!', 'success');
    }

    createRoom() {
        if (!this.playerName) {
            this.showStatus('Please set your name first', 'error');
            return;
        }

        this.showLoading('Creating room...');
        this.socket.emit('create-room', {});
    }

    joinRoom() {
        const roomCodeInput = document.getElementById('room-code');
        const roomCode = roomCodeInput.value.trim().toUpperCase();

        if (!roomCode) {
            this.showStatus('Please enter a room code', 'error');
            return;
        }

        if (roomCode.length !== 6) {
            this.showStatus('Room code must be 6 characters', 'error');
            return;
        }

        if (!this.playerName) {
            this.showStatus('Please set your name first', 'error');
            return;
        }

        this.showLoading('Joining room...');
        this.socket.emit('join-room', { roomId: roomCode });
    }

    async refreshRooms() {
        try {
            const response = await fetch('/api/rooms');
            const rooms = await response.json();
            this.displayRooms(rooms);
        } catch (error) {
            console.error('Failed to fetch rooms:', error);
            this.showStatus('Failed to load rooms', 'error');
        }
    }

    displayRooms(rooms) {
        const roomsList = document.getElementById('rooms-list');
        
        if (rooms.length === 0) {
            roomsList.innerHTML = '<p class="no-rooms">No rooms available. Create one to get started!</p>';
            return;
        }

        roomsList.innerHTML = '';
        
        rooms.forEach(room => {
            const roomItem = document.createElement('div');
            roomItem.className = 'room-item';

            const roomInfo = document.createElement('div');
            roomInfo.className = 'room-info';

            const roomCode = document.createElement('div');
            roomCode.className = 'room-code';
            roomCode.textContent = room.roomId;

            const roomPlayers = document.createElement('div');
            roomPlayers.className = 'room-players';
            roomPlayers.textContent = `${room.playerCount}/${room.maxPlayers} players • ${room.gameState}`;

            roomInfo.appendChild(roomCode);
            roomInfo.appendChild(roomPlayers);

            const joinBtn = document.createElement('button');
            joinBtn.className = room.canJoin ? 'secondary-btn' : 'secondary-btn';
            joinBtn.textContent = room.canJoin ? 'Join' : 'Full';
            joinBtn.disabled = !room.canJoin;

            if (room.canJoin) {
                joinBtn.addEventListener('click', () => {
                    document.getElementById('room-code').value = room.roomId;
                    this.joinRoom();
                });
            }

            roomItem.appendChild(roomInfo);
            roomItem.appendChild(joinBtn);
            roomsList.appendChild(roomItem);
        });
    }

    navigateToGame(roomId) {
        // Store player info in session storage for the game page
        sessionStorage.setItem('playerName', this.playerName);
        sessionStorage.setItem('playerId', this.playerId);
        sessionStorage.setItem('roomId', roomId);
        
        console.log(`Navigating to game with player ID: ${this.playerId}, room: ${roomId}`);
        
        // Navigate to game page
        window.location.href = `/game/${roomId}`;
    }

    showNameSetup() {
        document.getElementById('name-setup').classList.remove('hidden');
        document.getElementById('lobby').classList.add('hidden');
        
        // Focus on name input
        setTimeout(() => {
            document.getElementById('player-name').focus();
        }, 100);
    }

    showLobby() {
        document.getElementById('name-setup').classList.add('hidden');
        document.getElementById('lobby').classList.remove('hidden');
        
        // Update display name
        document.getElementById('display-name').textContent = this.playerName;
        
        // Clear room code input
        document.getElementById('room-code').value = '';
    }

    isLobbyVisible() {
        return !document.getElementById('lobby').classList.contains('hidden');
    }

    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const text = overlay.querySelector('p');
        text.textContent = message;
        overlay.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    showStatus(message, type = 'success') {
        const statusElement = document.getElementById('status-message');
        const statusText = document.getElementById('status-text');
        
        statusText.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideStatus();
        }, 5000);
    }

    hideStatus() {
        document.getElementById('status-message').classList.add('hidden');
    }
}

// Initialize lobby when page loads
document.addEventListener('DOMContentLoaded', () => {
    new LobbyManager();
});
