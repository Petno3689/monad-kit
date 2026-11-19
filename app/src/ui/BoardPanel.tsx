import { useCallback } from 'react';
import type { Address } from 'viem';
import { rarityName } from '@shared/chestMath';
import type { Rarity } from '@shared/chestMath';
import { publicClient } from '../chain';
import { readBoard } from '../chest';
import { displayName, readNames } from '../names';
import { usePoll } from './usePoll';

const BOARD_EVERY_MS = 10_000;

const scoreName = (score: bigint) => (score >= 1n && score <= 5n ? rarityName(Number(score) as Rarity) : String(score));

interface Props {
  chest: Address;
  /** Nicknames are shown only when a registry is deployed. */
  registry: Address | null;
  /** The game key's address, to highlight its row. */
  me: Address | null;
}

export function BoardPanel({ chest, registry, me }: Props) {
  const load = useCallback(async () => {
    const entries = await readBoard(publicClient, chest);
    const names = registry ? await readNames(publicClient, registry, entries.map((e) => e.player)) : new Map<string, string>();
    return { entries, names };
  }, [chest, registry]);
  const board = usePoll(load, BOARD_EVERY_MS).value;

  return (
    <section>
      <h2>Score board</h2>
      {board === undefined ? <p>Loading…</p> : null}
      {board?.entries.length === 0 ? <p>No one on the board yet.</p> : null}
      {board && board.entries.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Best chest</th>
              <th>Entries</th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((entry, i) => (
              <tr key={entry.player} className={me !== null && entry.player.toLowerCase() === me.toLowerCase() ? 'me' : undefined}>
                <td>{i + 1}</td>
                <td>{displayName(board.names.get(entry.player.toLowerCase()) ?? '', entry.player)}</td>
                <td>{scoreName(entry.score)}</td>
                <td>{entry.entries.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
