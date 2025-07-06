# 🐱💥 Exploding Kittens - Multiplayer Web Game

A fully functional web-based multiplayer implementation of the popular Exploding Kittens card game. Play with friends over the internet in real-time!

## Features

- **Real-time Multiplayer**: Play with 2-5 players online
- **Complete Game Rules**: Full implementation of standard Exploding Kittens rules
- **Beautiful UI**: Modern, responsive design with card animations
- **Room System**: Create or join game rooms with unique codes
- **Live Game State**: Real-time updates for all players
- **Interactive Cards**: Click to play cards with visual feedback
- **Game Log**: Track all game actions and events
- **Mobile Friendly**: Responsive design works on desktop and mobile

## How to Play

### Objective
Be the last player standing by avoiding Exploding Kittens!

### Game Setup
1. Each player starts with 4 cards + 1 Defuse card
2. Exploding Kitten cards are shuffled into the deck (1 fewer than number of players)
3. Players take turns in random order

### Gameplay
1. **Play Cards** (optional): Play action cards from your hand
2. **Draw Card**: Draw one card from the deck to end your turn
3. **Survive**: If you draw an Exploding Kitten, use a Defuse card or you're eliminated!

### Card Types

#### Action Cards
- **Skip**: End your turn without drawing
- **Attack**: Next player takes 2 turns
- **See Future**: Look at the top 3 cards of the deck
- **Shuffle**: Shuffle the deck
- **Favor**: Force another player to give you a card
- **Nope**: Stop any action (except Exploding Kitten or Defuse)

#### Special Cards
- **Defuse**: Use to defuse an Exploding Kitten
- **Exploding Kitten**: You explode unless you have a Defuse card

#### Cat Cards
Play pairs of matching cat cards to steal a random card from another player:
- **Taco Cat** 🌮
- **Rainbow Cat** 🌈
- **Potato Cat** 🥔
- **Beard Cat** 🧔
- **Cattermelon** 🍉

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone or download the project files
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser and go to:
   ```
   http://localhost:3000
   ```

### Playing the Game

1. **Enter Your Name**: Type your player name and click "Join Lobby"
2. **Create or Join Room**: 
   - Click "Create Room" to start a new game
   - Or enter a room code to join an existing game
3. **Wait for Players**: Games need 2-5 players to start
4. **Start Game**: Click "Start Game" when ready
5. **Play**: Take turns playing cards and drawing from the deck
6. **Win**: Be the last player standing!

## Game Controls

### In Lobby
- **Create Room**: Start a new game room
- **Join Room**: Enter a 6-character room code
- **Refresh**: Update the list of available rooms

### In Game
- **Click Cards**: Select and play cards from your hand
- **Draw Card**: Click the "Draw Card" button to end your turn
- **Target Selection**: Choose target players for certain cards
- **Modal Interactions**: Respond to game prompts and actions

## Technical Details

### Architecture
- **Backend**: Node.js with Express and Socket.IO
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Real-time Communication**: WebSocket connections via Socket.IO
- **Game Logic**: Server-side validation and state management

### File Structure
```
exploding-kittens/
├── server/
│   ├── server.js          # Main server and Socket.IO handling
│   ├── gameLogic.js       # Core game rules and mechanics
│   ├── cardDeck.js        # Card management and deck operations
│   └── roomManager.js     # Room creation and player management
├── public/
│   ├── index.html         # Lobby page
│   ├── game.html          # Game page
│   ├── css/
│   │   └── styles.css     # All styling and responsive design
│   └── js/
│       ├── lobby.js       # Lobby functionality
│       ├── game.js        # Game page interactions
│       └── cards.js       # Card rendering and utilities
├── package.json           # Dependencies and scripts
└── README.md             # This file
```

### Key Features Implementation

#### Real-time Multiplayer
- Socket.IO handles all real-time communication
- Game state synchronized across all players
- Automatic reconnection handling

#### Game Logic
- Server-side validation prevents cheating
- Complete rule implementation including all card effects
- Turn management and win condition checking

#### User Interface
- Responsive design works on all screen sizes
- Smooth animations and visual feedback
- Intuitive card selection and targeting

## Customization

### Adding New Cards
1. Add card type to `cardDeck.js`
2. Implement card logic in `gameLogic.js`
3. Add visual styling in `styles.css`
4. Update card renderer in `cards.js`

### Modifying Game Rules
- Edit game logic in `server/gameLogic.js`
- Update card deck composition in `server/cardDeck.js`
- Adjust UI elements as needed

### Styling Changes
- All styles are in `public/css/styles.css`
- Uses CSS Grid and Flexbox for responsive layout
- CSS custom properties for easy color theming

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Performance

- Optimized for low latency multiplayer
- Efficient state management
- Minimal bandwidth usage
- Automatic cleanup of empty rooms

## Troubleshooting

### Common Issues

1. **Can't connect to server**
   - Make sure the server is running on port 3000
   - Check firewall settings

2. **Game not loading**
   - Refresh the page
   - Clear browser cache
   - Check browser console for errors

3. **Cards not responding**
   - Make sure it's your turn
   - Check if there's a pending action to respond to

### Development Mode

For development with auto-restart:
```bash
npm run dev
```

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - feel free to use this code for your own projects.

---

**Enjoy playing Exploding Kittens with your friends! 🐱💥**
