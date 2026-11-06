import { useState, type FormEvent } from 'react';
import { useFateClient, useRequest, useView } from 'react-fate';
import { WorkspaceView } from '../src/state.ts';

export default function Tasks() {
  const fate = useFateClient();
  const { workspace } = useRequest({ workspace: { view: WorkspaceView } });
  const { progress, tasks } = useView(WorkspaceView, workspace);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const run = async (mutate: () => Promise<{ error?: Error }>) => {
    setPending(true);
    setError('');
    try {
      const result = await mutate();
      if (result.error) {
        setError(result.error.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim()) {
      void run(async () => {
        const result = await fate.mutations.task.add({ input: { title } });
        if (!result.error) {
          setTitle('');
        }
        return result;
      });
    }
  };

  return (
    <>
      <h1>Tasks</h1>
      <p>{progress}</p>
      <form onSubmit={add}>
        <input
          aria-label="Task title"
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
        <button disabled={pending} type="submit">
          Add task
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {tasks.map(({ done, id, title }) => (
          <li key={id}>
            <label>
              <input
                checked={done}
                disabled={pending}
                onChange={() => void run(() => fate.mutations.task.toggle({ input: { id } }))}
                type="checkbox"
              />
              {title}
            </label>
            <button
              aria-label={`Remove ${title}`}
              disabled={pending}
              onClick={() => void run(() => fate.mutations.task.remove({ input: { id } }))}
              type="button"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
