import {
  CARD_DEFS,
  CORE_AXIS_DEFS,
  CORE_AXIS_IDS,
  ENEMY_DEFS,
  HERO_DEFS,
  MAP_DEFS,
  RELIC_DEFS,
  ROUTE_NODE_DEFS,
  TOWER_DEFS,
  type CardId,
  type CoreAxisId,
  type MapId,
  type RelicId,
} from '../game/content';
import {
  GameModel,
  AXIS_BREAKTHROUGH_DEFS,
  AXIS_FOCUS_DEFS,
  AXIS_KEYSTONE_DEFS,
  AXIS_MASTERY_DEFS,
  AXIS_TECHNIQUE_DEFS,
  AXIS_TRIAL_DEFS,
  CORE_AXIS_PROTOCOL_DEFS,
  ENEMY_AFFIX_DEFS,
  MINIBOSS_VARIANT_DEFS,
  PACK_SYNERGY_DEFS,
  activeCoreAxisProtocols,
  activeAxisResonances,
  axisBreakthroughTier,
  axisSurgeForCard,
  axisTechniqueCost,
  canUseAxisTechnique,
  coreAxisProtocolTier,
  effectiveCardCost,
  inspectTower,
  rewardLabel,
  selectedCard,
  type AppSnapshot,
  type RunState,
} from '../game/simulation';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cardClass(run: RunState, instanceId: string): string {
  return run.selectedCardInstanceId === instanceId ? 'card selected' : 'card';
}

function renderDeckStats(run: RunState): string {
  return `
    <span><b>${run.hand.length}</b> hand</span>
    <span><b>${run.drawPile.length}</b> draw</span>
    <span><b>${run.discardPile.length}</b> discard</span>
  `;
}

function renderRelics(run: RunState): string {
  if (run.relics.length === 0) {
    return '<p class="empty">No run relics yet.</p>';
  }
  return run.relics
    .map((relicId) => {
      const relic = RELIC_DEFS[relicId];
      return `<li><span class="pip relic"></span><strong>${escapeHtml(relic.name)}</strong><small>${escapeHtml(relic.description)}</small></li>`;
    })
    .join('');
}

function renderRoster(run: RunState): string {
  const heroes = run.heroes
    .map((hero) => {
      const def = HERO_DEFS[hero.kind];
      const powers = hero.powerups.length > 0 ? hero.powerups.join(', ') : 'no powerups';
      return `<li><span class="pip hero"></span><strong>${escapeHtml(def.name)}</strong><small>${escapeHtml(def.role)} / ${escapeHtml(powers)}</small></li>`;
    })
    .join('');
  const machines = run.machines
    .map(() => '<li><span class="pip machine"></span><strong>Aether Mill</strong><small>+1 scrap and +1 charge after each wave</small></li>')
    .join('');
  return heroes || machines ? `${heroes}${machines}` : '<p class="empty">Recruit heroes or place machines through the deck.</p>';
}

function renderFieldSummary(run: RunState): string {
  const field = run.fieldSummary;
  return `
    <div class="field-summary">
      <span><b>${escapeHtml(field.dominant)}</b> dominant</span>
      <span>${field.hot} hot</span>
      <span>${field.cold} cold</span>
      <span>${field.volatile} fuel</span>
      <span>${field.conductive} metal</span>
      <span>${field.smoke} gas</span>
    </div>
  `;
}

function renderTerrainProfile(run: RunState): string {
  const terrain = run.terrainProfile;
  const generated = terrain.pockets.filter((pocket) => pocket.source === 'heuristic').length;
  return `
    <div class="terrain-profile">
      <strong>${escapeHtml(terrain.name)}</strong>
      <span>${escapeHtml(terrain.description)}</span>
      <small>${generated} generated pockets / ${escapeHtml(terrain.tags.join(' / '))}</small>
    </div>
  `;
}

function renderCoreAxes(run: RunState): string {
  return `
    <div class="axis-strip">
      ${CORE_AXIS_IDS.map((axis) => {
        const protocolTier = coreAxisProtocolTier(run, axis);
        return `<span><b>${escapeHtml(CORE_AXIS_DEFS[axis].name)}</b> ${run.coreAxes[axis]}${protocolTier > 0 ? ` / P${protocolTier}` : ''}</span>`;
      }).join('')}
    </div>
  `;
}

function renderAxisDirectives(run: RunState): string {
  return run.axisDirectives
    .map((directive) => {
      const percent = Math.min(100, Math.round((directive.progress / Math.max(1, directive.target)) * 100));
      const surgeCount = run.axisSurges[directive.axis] ?? 0;
      return `
        <li class="${directive.completed ? 'complete' : ''}">
          <div class="directive-top">
            <strong>${escapeHtml(directive.name)}</strong>
            <small><span>${directive.progress}/${directive.target}</span>${surgeCount > 0 ? `<b class="surge-chip">Surge x${surgeCount}</b>` : ''}</small>
          </div>
          <span>${escapeHtml(directive.description)}</span>
          <div class="directive-bar"><i style="width: ${percent}%"></i></div>
          <em>${escapeHtml(surgeCount > 0 ? 'Next matching card costs 0 and gains a bonus' : directive.completed ? 'Complete' : directive.reward)}</em>
        </li>
      `;
    })
    .join('');
}

function renderAxisMasteries(run: RunState): string {
  if (run.axisMasteries.length === 0) {
    return '<p class="empty">Complete directives to draft axis mastery branches.</p>';
  }

  return run.axisMasteries
    .map((masteryId) => {
      const mastery = AXIS_MASTERY_DEFS[masteryId];
      return `<li><span class="pip axis"></span><strong>${escapeHtml(mastery.name)}</strong><small>${escapeHtml(CORE_AXIS_DEFS[mastery.axis].name)} / ${escapeHtml(mastery.description)}</small></li>`;
    })
    .join('');
}

function renderAxisKeystones(run: RunState): string {
  if (run.axisKeystones.length === 0) {
    return '<p class="empty">Reach axis breakthrough tier 2 to draft keystone branches.</p>';
  }

  return run.axisKeystones
    .map((keystoneId) => {
      const keystone = AXIS_KEYSTONE_DEFS[keystoneId];
      return `<li><span class="pip axis"></span><strong>${escapeHtml(keystone.name)}</strong><small>${escapeHtml(CORE_AXIS_DEFS[keystone.axis].name)} / ${escapeHtml(keystone.description)}</small></li>`;
    })
    .join('');
}

function renderAxisResonances(run: RunState): string {
  const resonances = activeAxisResonances(run);
  if (resonances.length === 0) {
    return '<p class="empty">Pair two breakthrough tier 2 axes to unlock cross-axis resonance.</p>';
  }

  return resonances
    .map((resonance) => {
      const [firstAxis, secondAxis] = resonance.axes;
      const axisLabel = `${CORE_AXIS_DEFS[firstAxis].name} + ${CORE_AXIS_DEFS[secondAxis].name}`;
      return `<li><span class="pip axis"></span><strong>${escapeHtml(resonance.name)}</strong><small>${escapeHtml(axisLabel)} / ${escapeHtml(resonance.description)}</small></li>`;
    })
    .join('');
}

function renderCoreAxisProtocols(run: RunState): string {
  const active = activeCoreAxisProtocols(run);
  if (active.length === 0) {
    return '<p class="empty">Raise persistent Core Axis ranks to 2/4/6 to unlock protocols.</p>';
  }

  return CORE_AXIS_IDS.map((axis) => {
    const tier = coreAxisProtocolTier(run, axis);
    const current = CORE_AXIS_PROTOCOL_DEFS[axis].find((protocol) => protocol.tier === tier);
    const next = CORE_AXIS_PROTOCOL_DEFS[axis].find((protocol) => protocol.tier === tier + 1);
    return `
      <li>
        <span class="pip axis"></span>
        <strong>${escapeHtml(CORE_AXIS_DEFS[axis].name)} P${tier}</strong>
        <small>${
          current
            ? `${escapeHtml(current.name)} / ${escapeHtml(current.description)}`
            : next
              ? `Next: ${escapeHtml(next.name)} at rank ${next.rank}`
              : 'No active protocol yet.'
        }</small>
      </li>
    `;
  }).join('');
}

function renderAxisMomentum(run: RunState): string {
  return CORE_AXIS_IDS.map((axis) => {
    const value = run.axisMomentum[axis] ?? 0;
    const percent = Math.round((value / 6) * 100);
    return `
      <li>
        <div class="momentum-top">
          <strong>${escapeHtml(CORE_AXIS_DEFS[axis].name)}</strong>
          <small>${value}/6</small>
        </div>
        <div class="momentum-bar"><i style="width: ${percent}%"></i></div>
      </li>
    `;
  }).join('');
}

function renderAxisBreakthroughs(run: RunState): string {
  return CORE_AXIS_IDS.map((axis) => {
    const tier = axisBreakthroughTier(run, axis);
    const current = tier > 0 ? AXIS_BREAKTHROUGH_DEFS[axis].find((breakthrough) => breakthrough.tier === tier) : null;
    const next = AXIS_BREAKTHROUGH_DEFS[axis].find((breakthrough) => breakthrough.tier === tier + 1);
    return `
      <li>
        <span class="pip axis"></span>
        <strong>${escapeHtml(CORE_AXIS_DEFS[axis].name)} T${tier}</strong>
        <small>${current ? `${escapeHtml(current.name)} / ${escapeHtml(current.description)}` : next ? `Next: ${escapeHtml(next.name)} at ${next.threshold}P` : 'Fully stabilized.'}</small>
      </li>
    `;
  }).join('');
}

function renderAxisTechniques(run: RunState): string {
  return `
    <div class="technique-grid">
      ${CORE_AXIS_IDS.map((axis) => {
        const def = AXIS_TECHNIQUE_DEFS[axis];
        const momentum = run.axisMomentum[axis] ?? 0;
        const cost = axisTechniqueCost(run, axis);
        const disabled = !canUseAxisTechnique(run, axis);
        return `
          <button class="technique-button" data-action="axis-technique" data-axis="${axis}" ${disabled ? 'disabled' : ''}>
            <small>${escapeHtml(CORE_AXIS_DEFS[axis].name)} / ${momentum}/${cost}P</small>
            <strong>${escapeHtml(def.name)}</strong>
            <span>${escapeHtml(def.description)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderAxisFocus(run: RunState): string {
  return `
    <div class="focus-grid">
      ${CORE_AXIS_IDS.map((axis) => {
        const def = AXIS_FOCUS_DEFS[axis];
        const active = run.axisFocus === axis;
        const disabled = run.phase !== 'planning';
        return `
          <button class="focus-button${active ? ' active' : ''}" data-action="axis-focus" data-axis="${axis}" ${disabled ? 'disabled' : ''}>
            <small>${escapeHtml(CORE_AXIS_DEFS[axis].name)}${active ? ' / active' : ''}</small>
            <strong>${escapeHtml(def.name)}</strong>
            <span>${escapeHtml(def.description)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderDifficultyDirector(run: RunState): string {
  const director = run.difficultyDirector;
  const affixes =
    director.affixes.length > 0 ? director.affixes.map((affix) => ENEMY_AFFIX_DEFS[affix].name).join(', ') : 'none';
  const minibosses =
    director.minibosses.length > 0 ? director.minibosses.map((miniboss) => MINIBOSS_VARIANT_DEFS[miniboss].name).join(', ') : 'none';
  const synergies =
    director.synergies.length > 0 ? director.synergies.map((synergy) => PACK_SYNERGY_DEFS[synergy].name).join(', ') : 'none';
  const pressure = director.adaptivePressure > 0 ? `+${director.adaptivePressure}` : `${director.adaptivePressure}`;
  return `
    <div class="director-panel">
      <div class="director-top">
        <strong>${director.spentBudget}/${director.directorBudget}</strong>
        <small>budget / adaptive ${pressure}</small>
      </div>
      <span>${escapeHtml(director.summary)}</span>
      <ul class="mini-list">
        <li><span class="pip pressure"></span><strong>Power Read</strong><small>${director.playerPower} player vs ${director.expectedPower} expected. Authored enemy budget ${director.authoredBudget}.</small></li>
        <li><span class="pip pressure"></span><strong>Axis Focus</strong><small>${director.focusAxis ? `${escapeHtml(CORE_AXIS_DEFS[director.focusAxis].name)} / pressure +${director.focusPressure}` : run.axisFocus ? `${escapeHtml(CORE_AXIS_DEFS[run.axisFocus].name)} armed` : 'none'}</small></li>
        <li><span class="pip pressure"></span><strong>Affixes</strong><small>${escapeHtml(affixes)}</small></li>
        <li><span class="pip pressure"></span><strong>Miniboss</strong><small>${escapeHtml(minibosses)}</small></li>
        <li><span class="pip pressure"></span><strong>Pack Synergy</strong><small>${escapeHtml(synergies)}</small></li>
      </ul>
    </div>
  `;
}

function renderActiveTrial(run: RunState): string {
  if (!run.activeTrial) {
    return '<p class="empty">No active axis trial.</p>';
  }
  const trial = AXIS_TRIAL_DEFS[run.activeTrial];
  return `
    <div class="active-trial">
      <small>${escapeHtml(CORE_AXIS_DEFS[trial.axis].name)} Trial / Threat +${trial.threat}</small>
      <strong>${escapeHtml(trial.name)}</strong>
      <span>${escapeHtml(trial.description)}</span>
      <em>${escapeHtml(trial.reward)}</em>
    </div>
  `;
}

function renderMobileAxisStrip(run: RunState): string {
  const resonanceCount = activeAxisResonances(run).length;
  const directorPressure = run.difficultyDirector.adaptivePressure;
  const directorPressureText = directorPressure > 0 ? `+${directorPressure}` : `${directorPressure}`;
  return `
    <div class="mobile-axis-strip">
      ${run.axisDirectives
        .map((directive) => {
          const def = CORE_AXIS_DEFS[directive.axis];
          const surgeCount = run.axisSurges[directive.axis] ?? 0;
          const masteryCount = run.axisMasteries.filter((masteryId) => AXIS_MASTERY_DEFS[masteryId].axis === directive.axis).length;
          const momentum = run.axisMomentum[directive.axis] ?? 0;
          const breakthrough = axisBreakthroughTier(run, directive.axis);
          const protocol = coreAxisProtocolTier(run, directive.axis);
          return `
            <span class="${directive.completed ? 'complete' : ''}">
              <b>${escapeHtml(def.name.slice(0, 1))}</b>
              ${directive.progress}/${directive.target}
              ${protocol > 0 ? `<u>X${protocol}</u>` : ''}
              ${surgeCount > 0 ? `<em>S${surgeCount}</em>` : ''}
              ${masteryCount > 0 ? `<i>M${masteryCount}</i>` : ''}
              ${momentum > 0 ? `<small>P${momentum}</small>` : ''}
              ${breakthrough > 0 ? `<strong>B${breakthrough}</strong>` : ''}
            </span>
          `;
        })
        .join('')}
      <span class="resonance-chip">
        <b>R</b>
        <strong>${resonanceCount}</strong>
        <small>Pairs</small>
      </span>
      <span class="director-chip">
        <b>D</b>
        <strong>${directorPressureText}</strong>
        <small>Pressure</small>
      </span>
      <span class="focus-chip">
        <b>F</b>
        <strong>${run.axisFocus ? escapeHtml(CORE_AXIS_DEFS[run.axisFocus].name.slice(0, 1)) : '-'}</strong>
        <small>Focus</small>
      </span>
    </div>
  `;
}

function renderInspect(run: RunState): string {
  const tower = inspectTower(run);
  if (tower) {
    const def = TOWER_DEFS[tower.kind];
    return `
      <section class="inspect">
        <h3>${escapeHtml(def.name)}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="stats-row">
          <span>Lv ${tower.level}</span>
          <span>Damage ${tower.branches.damage}</span>
          <span>Range ${tower.branches.range}</span>
          <span>Tempo ${tower.branches.tempo}</span>
        </div>
      </section>
    `;
  }
  if (run.inspectTarget?.kind === 'cell') {
    return `
      <section class="inspect">
        <h3>Cell ${run.inspectTarget.point.x},${run.inspectTarget.point.y}</h3>
        <p>Use targeted cards on open pads or existing towers.</p>
      </section>
    `;
  }
  return '';
}

function renderHand(run: RunState): string {
  const cards = run.hand
    .map((instance) => {
      const card = CARD_DEFS[instance.cardId];
      const effectiveCost = effectiveCardCost(run, instance.cardId);
      const surgeAxis = axisSurgeForCard(instance.cardId);
      const surged = surgeAxis ? run.axisSurges[surgeAxis] > 0 : false;
      const disabled = run.energy < effectiveCost || run.phase === 'reward' || run.phase === 'route' || run.phase === 'defeat' || run.phase === 'victory';
      const target = card.target === 'none' ? 'Instant' : card.target === 'tower' ? 'Tower' : card.target === 'cell' ? 'Cell' : 'Pad';
      const costLabel = effectiveCost === card.cost ? `${card.cost}` : `${effectiveCost}/${card.cost}`;
      return `
        <button class="${cardClass(run, instance.instanceId)}${surged ? ' surged' : ''}" data-action="card" data-id="${escapeHtml(instance.instanceId)}" ${disabled ? 'disabled' : ''}>
          <span class="card-top"><b>${escapeHtml(card.name)}</b><em>${costLabel}</em></span>
          <span>${escapeHtml(card.description)}</span>
          <small>${escapeHtml(card.type)} / ${target}${surged && surgeAxis ? ` / ${escapeHtml(CORE_AXIS_DEFS[surgeAxis].name)} Surge` : ''}</small>
        </button>
      `;
    })
    .join('');
  return cards || '<p class="empty">No cards in hand.</p>';
}

function renderRewards(run: RunState): string {
  if (run.phase !== 'reward') return '';
  return `
    <div class="modal reward-modal">
      <div class="modal-panel">
        <h2>Wave ${run.wave} Reward</h2>
        <div class="reward-grid">
          ${run.rewardChoices
            .map(
              (choice) => `
                <button class="reward-choice" data-action="reward" data-id="${escapeHtml(choice.choiceId)}">
                  <small>${escapeHtml(choice.type)}</small>
                  <strong>${escapeHtml(choice.name)}</strong>
                  <span>${escapeHtml(rewardLabel(choice))}</span>
                </button>
              `,
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderRoutes(run: RunState): string {
  if (run.phase !== 'route') return '';
  return `
    <div class="modal route-modal">
      <div class="modal-panel">
        <h2>Route To Wave ${run.wave}</h2>
        <div class="route-grid">
          ${run.routeChoices
            .map((choice) => {
              const route = ROUTE_NODE_DEFS[choice.type];
              const trial = choice.trial ? AXIS_TRIAL_DEFS[choice.trial] : null;
              return `
                <button class="route-choice" data-action="route" data-id="${escapeHtml(choice.choiceId)}">
                  <small>Threat ${choice.threat} / ${escapeHtml(route.rewardBias)}</small>
                  <strong>${escapeHtml(choice.name)}</strong>
                  <span>${escapeHtml(choice.description)}</span>
                  ${
                    trial
                      ? `<em class="route-trial">${escapeHtml(CORE_AXIS_DEFS[trial.axis].name)} Trial: ${escapeHtml(trial.name)} / ${escapeHtml(trial.reward)}</em>`
                      : ''
                  }
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderEnd(run: RunState): string {
  if (run.phase !== 'defeat' && run.phase !== 'victory') return '';
  const title = run.phase === 'victory' ? 'The Relic Line Holds' : 'Relay Core Lost';
  const unlocks = run.runUnlocks.length > 0 ? run.runUnlocks.map((unlock) => `<li>${escapeHtml(unlock)}</li>`).join('') : '<li>No new profile unlocks this run.</li>';
  return `
    <div class="modal end-modal">
      <div class="modal-panel">
        <h2>${title}</h2>
        <p>Wave ${run.wave}, ${run.stats.kills} kills, ${run.stats.towersBuilt} towers, ${run.stats.heroesRecruited} heroes.</p>
        <ul class="unlock-list">${unlocks}</ul>
        <div class="modal-actions">
          <button data-action="new-run">New Run</button>
        </div>
      </div>
    </div>
  `;
}

function renderMenu(snapshot: AppSnapshot): string {
  const profile = snapshot.profile;
  const mapChoices = profile.unlockedMaps
    .map((mapId) => {
      const map = MAP_DEFS[mapId];
      return `
        <button class="map-choice" data-action="new-run" data-map="${escapeHtml(mapId)}">
          <strong>${escapeHtml(map.name)}</strong>
          <span>${escapeHtml(map.description)}</span>
        </button>
      `;
    })
    .join('');
  const axisRows = CORE_AXIS_IDS.map((axis) => {
    const def = CORE_AXIS_DEFS[axis];
    const tier = Math.max(0, CORE_AXIS_PROTOCOL_DEFS[axis].filter((protocol) => profile.coreAxes[axis] >= protocol.rank).length);
    const protocol = tier > 0 ? CORE_AXIS_PROTOCOL_DEFS[axis][tier - 1] : null;
    return `<li><strong>${escapeHtml(def.name)} ${profile.coreAxes[axis]}${tier > 0 ? ` / Protocol ${tier}` : ''}</strong><small>${escapeHtml(protocol ? protocol.description : def.description)}</small></li>`;
  }).join('');
  return `
    <div class="modal menu-modal">
      <div class="menu-panel">
        <div>
          <p class="eyebrow">State-Space Prototype</p>
          <h1>Relic Line</h1>
          <p class="menu-copy">Tower defense, deck drafting, autonomous heroes, and profile unlocks in one compact run loop.</p>
          <div class="map-grid">${mapChoices}</div>
          <div class="menu-actions">
            <button data-action="new-run">Start Run</button>
            <button class="ghost" data-action="reset-profile">Reset Profile</button>
          </div>
        </div>
        <div class="profile-card">
          <h2>${escapeHtml(profile.name)}</h2>
          <div class="profile-stats">
            <span><b>${profile.runs}</b> runs</span>
            <span><b>${profile.wins}</b> wins</span>
          <span><b>${profile.bestWave}</b> best wave</span>
          <span><b>${profile.memoryShards}</b> shards</span>
        </div>
        <h3>Persistent Unlocks</h3>
          <p>${profile.unlockedCards.length} cards, ${profile.unlockedRelics.length} relics, ${profile.unlockedHeroes.length} heroes, ${profile.unlockedMaps.length} maps</p>
          <ul class="axis-list">${axisRows}</ul>
        </div>
      </div>
    </div>
  `;
}

function renderRun(snapshot: AppSnapshot): string {
  const run = snapshot.run;
  if (!run) return renderMenu(snapshot);
  const selected = selectedCard(run);
  const waveButton = run.phase === 'planning' ? '<button data-action="start-wave">Start Wave</button>' : '';
  const pauseLabel = run.phase === 'paused' ? 'Resume' : 'Pause';
  const targetHint = selected ? `<div class="target-hint">Selected: ${escapeHtml(CARD_DEFS[selected.cardId].name)}. ${CARD_DEFS[selected.cardId].target === 'none' ? 'Play it from hand.' : 'Click a valid target on the map.'}</div>` : '';
  const strongestEnemy = run.enemies
    .map((enemy) => ENEMY_DEFS[enemy.kind].name)
    .slice(0, 3)
    .join(', ');
  const activeRouteLabel = run.activeTrial
    ? `${ROUTE_NODE_DEFS[run.activeRoute].name} / ${AXIS_TRIAL_DEFS[run.activeTrial].name}`
    : ROUTE_NODE_DEFS[run.activeRoute].name;
  return `
    <div class="top-hud">
      <div class="brand-chip"><span class="mark"></span><b>Relic Line</b></div>
      <div class="hud-stat">Wave <b>${run.wave}</b></div>
      <div class="hud-stat">Lives <b>${run.lives}</b></div>
      <div class="hud-stat">Scrap <b>${run.scrap}</b></div>
      <div class="hud-stat">Charge <b>${run.charge}</b></div>
      <div class="hud-stat">Energy <b>${run.energy}</b></div>
      <div class="hud-stat wide"><b>${escapeHtml(MAP_DEFS[run.mapId].name)}</b><small>${escapeHtml(activeRouteLabel)}</small></div>
      <div class="deck-stats">${renderDeckStats(run)}</div>
      <div class="hud-actions">${waveButton}<button class="ghost" data-action="pause">${pauseLabel}</button></div>
    </div>
    ${renderMobileAxisStrip(run)}
    ${targetHint}
    <aside class="side-panel">
      <section>
        <h2>Run Relics</h2>
        <ul class="mini-list">${renderRelics(run)}</ul>
      </section>
      <section>
        <h2>Heroes & Machines</h2>
        <ul class="mini-list">${renderRoster(run)}</ul>
      </section>
      ${renderInspect(run)}
      <section>
        <h2>State-Space Field</h2>
        ${renderCoreAxes(run)}
        ${renderTerrainProfile(run)}
        ${renderFieldSummary(run)}
        <ul class="log-list physics">
          ${run.physicsEvents.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}
        </ul>
      </section>
      <section>
        <h2>Axis Directives</h2>
        <ul class="directive-list">${renderAxisDirectives(run)}</ul>
      </section>
      <section>
        <h2>Axis Focus</h2>
        ${renderAxisFocus(run)}
      </section>
      <section>
        <h2>Axis Momentum</h2>
        <ul class="momentum-list">${renderAxisMomentum(run)}</ul>
      </section>
      <section>
        <h2>Core Protocols</h2>
        <ul class="mini-list">${renderCoreAxisProtocols(run)}</ul>
      </section>
      <section>
        <h2>Axis Breakthroughs</h2>
        <ul class="mini-list">${renderAxisBreakthroughs(run)}</ul>
      </section>
      <section>
        <h2>Axis Techniques</h2>
        ${renderAxisTechniques(run)}
      </section>
      <section>
        <h2>Axis Trial</h2>
        ${renderActiveTrial(run)}
      </section>
      <section>
        <h2>Difficulty Director</h2>
        ${renderDifficultyDirector(run)}
      </section>
      <section>
        <h2>Axis Masteries</h2>
        <ul class="mini-list">${renderAxisMasteries(run)}</ul>
      </section>
      <section>
        <h2>Axis Keystones</h2>
        <ul class="mini-list">${renderAxisKeystones(run)}</ul>
      </section>
      <section>
        <h2>Axis Resonance</h2>
        <ul class="mini-list">${renderAxisResonances(run)}</ul>
      </section>
      <section>
        <h2>Field Log</h2>
        <ul class="log-list">
          ${run.log.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}
        </ul>
        <p class="enemy-line">${strongestEnemy ? `On field: ${escapeHtml(strongestEnemy)}` : 'Path clear.'}</p>
      </section>
    </aside>
    <div class="hand-bar">${renderHand(run)}</div>
    ${renderRewards(run)}
    ${renderRoutes(run)}
    ${renderEnd(run)}
  `;
}

export function mountHud(model: GameModel, root: HTMLElement): void {
  let lastSnapshot: AppSnapshot = model.snapshot();

  function render(snapshot = model.snapshot()): void {
    lastSnapshot = snapshot;
    root.innerHTML = renderRun(snapshot);
  }

  function handleButtonAction(button: HTMLButtonElement): void {
    if (button.disabled) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    const run = lastSnapshot.run;

    if (action === 'new-run') {
      model.startRun(undefined, button.dataset.map as MapId | undefined);
      return;
    }
    if (action === 'reset-profile') {
      model.resetProfile();
      return;
    }
    if (action === 'start-wave') {
      model.startWave();
      return;
    }
    if (action === 'pause') {
      model.togglePause();
      return;
    }
    if (action === 'reward' && id) {
      model.chooseReward(id);
      return;
    }
    if (action === 'route' && id) {
      model.chooseRoute(id);
      return;
    }
    if (action === 'axis-technique' && button.dataset.axis) {
      model.useAxisTechnique(button.dataset.axis as CoreAxisId);
      return;
    }
    if (action === 'axis-focus' && button.dataset.axis) {
      model.setAxisFocus(button.dataset.axis as CoreAxisId);
      return;
    }
    if (action === 'card' && id && run) {
      const card = run.hand.find((candidate) => candidate.instanceId === id);
      if (!card) return;
      const def = CARD_DEFS[card.cardId as CardId];
      if (def.target === 'none') {
        model.playCard(id);
      } else {
        model.selectCard(id);
      }
    }
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    event.preventDefault();
    button.classList.add('pressed');
    handleButtonAction(button);
  });

  root.addEventListener('click', (event) => {
    if (event.detail > 0 && 'PointerEvent' in window) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    handleButtonAction(button);
  });

  model.subscribe(render);
}
