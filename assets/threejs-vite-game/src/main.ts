import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

let game: Game | undefined;

try {
  game = new Game(canvas);
  game.start();
} catch (error) {
  console.error('Three.js game startup failed', error);
  document.querySelector('#app')?.classList.add('startup-failed');
  const message = document.createElement('section');
  message.className = 'startup-error';
  message.setAttribute('role', 'alert');
  message.setAttribute('aria-live', 'assertive');
  message.textContent =
    'The 3D renderer could not start. Reload the page or try another browser/device.';
  document.querySelector('#app')?.append(message);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
