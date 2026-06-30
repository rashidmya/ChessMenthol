import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EngineSettings from '../components/EngineSettings.svelte';

// Under jsdom isTauri() is false, so EngineOptions shows "options unavailable".
// No Tauri mock is needed because engineOptions.ensureSchema short-circuits on !isTauri().
it('renders the "Engine options" section with EngineOptions inside', async () => {
  const { getByText, findByText } = render(EngineSettings, {
    props: { engineId: 'stockfish', onCommand: vi.fn(), onSetEngine: vi.fn() },
  });
  expect(getByText('Engine options')).toBeTruthy();
  // EngineOptions resolves to "options unavailable" when not running inside Tauri
  expect(await findByText(/options unavailable/i)).toBeTruthy();
});

it('emits set_options { movetime } for the Search-time slider', async () => {
  const onCommand = vi.fn();
  const { getAllByRole } = render(EngineSettings, {
    props: { engineId: 'stockfish', onCommand, onSetEngine: vi.fn() },
  });
  const sliders = getAllByRole('slider') as HTMLInputElement[];
  // Search time is now the only slider in EngineSettings
  sliders[0].value = '5'; await fireEvent.input(sliders[0]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', movetime: null });
});
