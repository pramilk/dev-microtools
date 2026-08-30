import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { useImageJobBatch } from './useImageJobBatch';

interface FakeResult {
  url: string;
  value: string;
}

/** A minimal host exercising every part of the hook's API — the shape a real image tool builds on top of it. */
function Host() {
  const batch = useImageJobBatch<FakeResult>({ maxFiles: 2, idPrefix: 'test', createJob: (base) => ({ ...base, status: 'processing', result: null, error: null }) });

  const process = (id: string, outcome: 'ok' | 'fail') => {
    const seq = batch.startJob(id);
    if (outcome === 'fail') {
      batch.failJob(id, 'boom');
      return;
    }
    if (!batch.isCurrentSeq(id, seq)) return;
    batch.finishJob(id, { url: `blob:${id}`, value: 'done' });
  };

  return (
    <div>
      <button onClick={() => batch.addFiles([new File(['a'], 'a.png'), new File(['b'], 'b.png'), new File(['c'], 'c.png')])}>add-three</button>
      <button onClick={() => batch.clearAll()}>clear</button>
      <p data-testid="error">{batch.batchError}</p>
      <p data-testid="selected">{batch.selectedJob?.id ?? 'none'}</p>
      <ul>
        {batch.jobs.map((job) => (
          <li key={job.id} data-testid="job">
            <span>{job.id}</span>
            <span>{job.status}</span>
            <span>{job.result?.value ?? ''}</span>
            <span>{job.error ?? ''}</span>
            <button onClick={() => batch.setSelectedJobId(job.id)}>select-{job.id}</button>
            <button onClick={() => process(job.id, 'ok')}>finish-{job.id}</button>
            <button onClick={() => process(job.id, 'fail')}>fail-{job.id}</button>
            <button onClick={() => batch.removeJob(job.id)}>remove-{job.id}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('useImageJobBatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts empty', () => {
    render(<Host />);
    expect(screen.queryAllByTestId('job')).toHaveLength(0);
    expect(screen.getByTestId('selected')).toHaveTextContent('none');
  });

  it('caps a batch at maxFiles and reports how many were skipped', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<Host />);

    fireEvent.click(screen.getByText('add-three'));

    expect(screen.getAllByTestId('job')).toHaveLength(2);
    expect(screen.getByTestId('error')).toHaveTextContent('Only 2 images can be processed in one batch — 1 extra file(s) were skipped.');
  });

  it('auto-selects the first job once added, and re-fixes selection once the selected job is removed', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<Host />);
    fireEvent.click(screen.getByText('add-three'));
    const jobs = screen.getAllByTestId('job');
    const firstId = jobs[0]!.textContent!.split('processing')[0];

    expect(screen.getByTestId('selected')).toHaveTextContent(firstId!);

    fireEvent.click(screen.getByText(`remove-${firstId}`));

    expect(screen.getByTestId('selected')).not.toHaveTextContent(firstId!);
    expect(screen.getAllByTestId('job')).toHaveLength(1);
  });

  it('moves a job through processing to done, storing its result', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<Host />);
    fireEvent.click(screen.getByText('add-three'));
    const id = screen.getAllByTestId('job')[0]!.textContent!.split('processing')[0]!;

    fireEvent.click(screen.getByText(`finish-${id}`));

    expect(screen.getAllByTestId('job')[0]).toHaveTextContent('done');
  });

  it('moves a job to an error state, clearing any previous result', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<Host />);
    fireEvent.click(screen.getByText('add-three'));
    const id = screen.getAllByTestId('job')[0]!.textContent!.split('processing')[0]!;

    fireEvent.click(screen.getByText(`fail-${id}`));

    expect(screen.getAllByTestId('job')[0]).toHaveTextContent('error');
    expect(screen.getAllByTestId('job')[0]).toHaveTextContent('boom');
  });

  it('revokes both the original and result object URLs when a job is removed', () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL });
    render(<Host />);
    fireEvent.click(screen.getByText('add-three'));
    const id = screen.getAllByTestId('job')[0]!.textContent!.split('processing')[0]!;
    fireEvent.click(screen.getByText(`finish-${id}`));

    fireEvent.click(screen.getByText(`remove-${id}`));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('clears every job, its error, and its selection on clearAll', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<Host />);
    fireEvent.click(screen.getByText('add-three'));
    expect(screen.getByTestId('error')).not.toBeEmptyDOMElement();

    fireEvent.click(screen.getByText('clear'));

    await waitFor(() => expect(screen.queryAllByTestId('job')).toHaveLength(0));
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('selected')).toHaveTextContent('none');
  });
});
