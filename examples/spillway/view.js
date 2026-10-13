import { Q } from './game.js';
import { EXIT } from './scene.js';

export function gameSprites(game, aim = null) {
    const p = game.player, x = p.x / Q, y = p.y / Q;
    const sprites = [];
    const rect = (x, y, w, h, r, g, b, a = 1) => sprites.push([x, y, w, h, r, g, b, a]);
    rect(EXIT.x - 2, EXIT.y - 3, 9, 13, .06, .21, .23);
    rect(EXIT.x, EXIT.y - 1, 5, 7, .22, .95, .72);
    rect(EXIT.x + 1, EXIT.y + 1, 3, 3, .77, 1, .89);
    rect(x - 1, y + 1, 7, 8, .025, .045, .06);
    rect(x, y + 3, 5, 4, .12, .65, .72);
    rect(x, y, 5, 3, 1, .71, .31);
    rect(x + (p.facing > 0 ? 2 : 0), y + 1, 3, 1, .78, .97, 1);
    const stride = p.grounded && p.vx && (game.field.tick % 12 < 6) ? .7 : 0;
    rect(x, y + 7, 2, 2 - stride, .63, .81, .83); rect(x + 3, y + 7, 2, 2 + stride, .63, .81, .83);
    rect(x + (p.facing > 0 ? 5 : -2), y + 4, 2, 2, .9, .37, .16);
    if (aim) { rect(aim[0] - 2, aim[1], 5, .3, 1, .8, .4, .8); rect(aim[0], aim[1] - 2, .3, 5, 1, .8, .4, .8); }
    return sprites;
}
