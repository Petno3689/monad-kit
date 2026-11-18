import { monadTestnet } from './chain';

export default function App() {
  return (
    <main>
      <h1>monad-kit</h1>
      <p>
        {monadTestnet.name} (chain id {monadTestnet.id})
      </p>
    </main>
  );
}
