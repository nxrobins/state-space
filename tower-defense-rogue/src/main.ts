import Phaser from 'phaser';
import { GameModel } from './game/simulation';
import { WORLD_HEIGHT, WORLD_WIDTH } from './game/content';
import { DefenseScene } from './phaser/DefenseScene';
import { mountHud } from './ui/hud';
import './styles.css';

const canvasParent = document.querySelector<HTMLElement>('#game-canvas');
const hudRoot = document.querySelector<HTMLElement>('#hud-root');

if (!canvasParent || !hudRoot) {
  throw new Error('Missing game shell elements.');
}

const model = new GameModel();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: canvasParent,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: '#171a1f',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  scene: [new DefenseScene(model)],
});

mountHud(model, hudRoot);
