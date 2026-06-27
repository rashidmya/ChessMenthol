import { it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EngineSettings from '../components/EngineSettings.svelte';

it('emits set_options for lines / search-time / threads / memory and set_engine', async () => {
  const onCommand = vi.fn(); const onSetEngine = vi.fn();
  const { getAllByRole, getByRole } = render(EngineSettings, { props: { engineId: 'stockfish', onCommand, onSetEngine } });
  const sliders = getAllByRole('slider') as HTMLInputElement[]; // [Lines, SearchTime, Threads, Memory]
  sliders[0].value = '4'; await fireEvent.input(sliders[0]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', multipv: 4 });
  sliders[1].value = '5'; await fireEvent.input(sliders[1]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', movetime: null });
  sliders[2].value = '8'; await fireEvent.input(sliders[2]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', threads: 8 });
  sliders[3].value = '5'; await fireEvent.input(sliders[3]);
  expect(onCommand).toHaveBeenCalledWith({ type: 'set_options', hash: 512 });
});
