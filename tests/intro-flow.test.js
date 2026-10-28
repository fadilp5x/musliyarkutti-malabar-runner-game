import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldPlayIntro } from '../src/game/introFlow.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('solo intro selection', () => {
  it('PLAY runs the story only before the intro has been seen', () => {
    expect(shouldPlayIntro('auto', false)).toBe(true);
    expect(shouldPlayIntro('auto', true)).toBe(false);
  });

  it('the Story action always forces the cinematic', () => {
    expect(shouldPlayIntro('force', false)).toBe(true);
    expect(shouldPlayIntro('force', true)).toBe(true);
  });

  it('marks the intro seen after it finishes and when it is skipped', () => {
    const game = read('src/game/Game.js');
    const cinematic = game.slice(game.indexOf('  async _startShaytan()'), game.indexOf('  // Skip the running cinematic'));
    const skip = game.slice(game.indexOf('  skipCinematic()'), game.indexOf('  // Arm the "any input skips"'));
    const finish = game.slice(game.indexOf('  _finishIntro()'), game.indexOf('  // Skip the running cinematic'));
    expect(cinematic).toContain('this._finishIntro()');
    expect(skip).toContain('this._finishIntro()');
    expect(finish).toContain('data.hasSeenIntro = true');
  });

  it('keeps the automatic first-run tutorial choice and lets forced Story reach its cinematic first', () => {
    const game = read('src/game/Game.js');
    const start = game.slice(game.indexOf('  startRun('), game.indexOf('  _continueSoloStart('));
    expect(start).toContain("startStory === 'auto'");
    expect(start).toContain('this._tutorialChoiceAfterIntro = true');
  });

  it('only explicit title buttons can start a solo run or story', () => {
    const menu = read('src/ui/MenuController.js');
    const party = read('src/party/PartyRace.js');
    const game = read('src/game/Game.js');
    const title = menu.slice(menu.indexOf('  _buildTap() {'), menu.indexOf('  // Best score'));
    expect(title).not.toMatch(/el\.addEventListener\(['"]click['"]/);
    expect(title).toContain("playButton.addEventListener('click'");
    expect(title).toContain("storyButton.addEventListener('click'");
    expect(title).toContain('this.ui.show(screen)');
    expect(party).not.toContain('this.game.startRun?.(');
    expect(party).toContain('this.game.startPartyRace?.');
    const libraryAction = game.slice(game.indexOf('  _onAction(action)'), game.indexOf('  _togglePause()'));
    expect(libraryAction).toContain('Only explicit title actions start a run or the story.');
    expect(libraryAction).not.toContain('_startShaytan()');
  });
});
