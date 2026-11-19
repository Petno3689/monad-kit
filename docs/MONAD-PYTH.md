# Monad и Pyth: справочник фактов

Каждый факт — с датой и источником в скобках. Даты — 2026 год. Числа не перемерять без причины; если мерили заново — обновить дату.

## Сеть (Monad testnet)

- Chain id **10143**. Публичный RPC https://testnet-rpc.monad.xyz (также https://rpc-testnet.monadinfra.com). [docs.monad.xyz «Network Information – Testnet», прочитано 19 ноя 2026]
- Лимиты публичного RPC: 20 запросов/с, batch 100, 5 batch/с. [docs.monad.xyz «Network Information – Testnet», 19 ноя 2026]
- Игра наблюдала около 15 запросов/с (октябрь 2026). Кит держится на 10/с, потому что лимит на IP общий с кошельком. [наблюдение игры, окт 2026; решение кита]
- Эксплореры: MonadVision https://testnet.monadvision.com, Monadscan https://testnet.monadscan.com. Faucet: https://faucet.monad.xyz. [docs.monad.xyz «Network Information – Testnet», 19 ноя 2026]
- Время блока около 400 мс. Максимальный размер контракта 128 KB. [docs.monad.xyz «Network Information – Testnet», 19 ноя 2026]

### Газ

- Списывается value + цена газа × **gas LIMIT** (не использованный газ). Кит отправляет estimate × 120 %. [игра: за 26 транзакций нужно было максимум 1,073 × estimate]
- Простой перевод MON на адрес без кода — 21 000 газа. [игра, 2026]
- Переоценка опкодов: холодный доступ к аккаунту 10 100 газа (Ethereum 2 600); холодное хранилище 8 100 за страницу в 128 слотов (Ethereum 2 100 за слот). [docs.monad.xyz «Opcode Pricing», 19 ноя 2026]
- `contracts/foundry.toml` содержит `network = "monad"`, поэтому forge считает по ценам Monad (Foundry ≥ 1.8; проверено на 1.8.3 и 1.9.0). [ревьюер, 19 ноя 2026]

### Reserve balance

- Резерв 10 MON на EOA, k = 3 блока (~1,2 с). Если баланс ниже 10 MON, транзакция, тратящая больше своего газа, откатывается, когда отправитель слал другую транзакцию в предыдущие 3 блока. После получения MON ждать, пока чеку исполнится 3 блока, и только потом тратить. EOA с делегированием EIP-7702 вообще не могут опускаться ниже 10 MON. [docs.monad.xyz, 19 ноя 2026] `txQueue` кита ждёт 3 блока после каждого включения. [код кита, `app/src/txQueue.ts`]

### Логи и отправка

- `eth_getLogs`: кит читает чанками по 100 блоков. На публичном RPC игра измерила: 101 блок принимается, 1000 отклоняется с 413. Документация Monad рекомендует малые диапазоны. [игра, 2026; docs.monad.xyz]
- Успех `eth_sendRawTransaction` означает «принято этим узлом», а не «включено». [docs.monad.xyz «Wallet Developer Integration Guide», 19 ноя 2026]
- viem повторяет при таймаутах, сетевых ошибках, −32603 и HTTP 403/408/413/429/5xx. Если отправка дошла до узла, а ответ потерян, повтор может вернуть «already known» / «nonce too low», хотя транзакция включится. Перед сообщением «не удалось» проверять по хэшу. Кит этого пока не делает (известное ограничение). [viem 2.58, `utils/buildRequest.ts`, `shouldRetry`; ревьюер, 19 ноя 2026]
- Вывод (withdraw) оставляет «пыль»: ключ резервирует gas × maxFeePerGas, а платит gas × effective price. Живой пример (владелец, 19 ноя 2026): tx `0x42a38f894c582ac1344ae7908315aa242c364b2e8c36c869abf669552b08dc70`, блок 81011118: отправлено 0,997438 MON, 21 000 газа, maxFeePerGas 122 gwei, effective 102 gwei (base 100 + priority 2), остаток 0,00042 MON = 21 000 × 20 gwei. [ончейн, 19 ноя 2026]

## Pyth Entropy V2 (Monad testnet)

> **ПРЕДУПРЕЖДЕНИЕ. Не использовать адрес Entropy `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320`.**
> Страница oracle в документации Monad указывает его как Entropy для testnet. Ончейн (19 ноя 2026) по этому адресу есть код, но `getDefaultProvider()` и `getFeeV2()` откатываются — это не рабочий Entropy V2 для кита.
> Рабочий адрес — ниже.

- Entropy proxy `0x825c0390f379C631f3Cf11A82a37D20BddF93c07`, провайдер по умолчанию `0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344` (docs.pyth.network, Entropy chainlist: провайдер по умолчанию для testnet). Проверено ончейн 19 ноя 2026 (блок 81012170): `getDefaultProvider()` возвращает его; `getFeeV2(provider, 1 000 000)` = 0,134296875 MON. Игра использует с октября 2026.
- Комиссия меняется: 0,12816 MON (28 окт 2026), ~0,1238 (16–18 ноя), 0,1343 (19 ноя). Читать `fee()` перед каждым запросом. [ончейн, даты указаны]
- Callback приходит в ПОЗДНЕЙ транзакции, обычно через 1–3 с после запроса. [наблюдение игры, окт–ноя 2026]
- Лимит газа callback задаётся на запрос; в ките он параметр деплоя, 1 000 000. [код кита, `MonadTestnet.CALLBACK_GAS_LIMIT`]
- Держать callback ≤ 2/3 лимита; по ценам Monad callback первого сундука стоит 123 828 газа. [forge, Monad-цены, 19 ноя 2026, `ChestCallbackGas.t.sol`]
- Callback, который откатился, остаётся записанным (V2 пишет сбои callback ончейн) и может быть выполнен повторно разработчиком через `revealWithCallback` на контракте Entropy. [docs.pyth.network «Debug Callback Failures», 19 ноя 2026; блог Pyth «Entropy V2: Onchain Randomness Gets an Upgrade»]
- Провайдер может вычислить результат до раскрытия (это допускает атаку цензурой); протокол предполагает, что провайдер не front-run'ит пользователей и не сговаривается с валидаторами. Состояние ончейн публично, поэтому всё, что выведено из раскрытого слова, видно всем. [docs.pyth.network «Protocol Design», 19 ноя 2026]
- `ChestGame.open()` под ценами Monad с mock-Pyth: 209 406 газа (один только запрос mock — 66 610); настоящий запрос Pyth дороже. Будет измерено на testnet после деплоя. [forge, 19 ноя 2026]

## Инструменты (опыт игры, 2026)

- Шаблон Foundry от Monad использует ключи `metadata` / `metadata_hash`, которые Foundry игнорирует, поэтому `bytecode_hash` остаётся ipfs. Кит задаёт `bytecode_hash = "none"` и `cbor_metadata = true`. [игра, 2026]
- Remix 2.6.0 падает после деплоя на Monad («Cannot read properties of undefined (reading 'result')»), хотя транзакция проходит. [игра, 2026]
- MetaMask/Blockaid показывает «security check unavailable» на подписях и пополнениях в Monad testnet; приложение это исправить не может. [игра, 2026]
- Foundry 1.8.3: `--interactive 1` разбирается как аргумент скрипта («encode length mismatch»); использовать keystore и `--account <name>`. [игра, 2026]
- Sourcify на Monad (BlockVision): `--verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/`. Проверка: GET `https://sourcify-api-monad.blockvision.org/v2/contract/10143/<address>` → `"match"`. Эндпоинт `/check-by-addresses` отвечает false даже для верифицированных контрактов. Если байткод равен ранее верифицированному, Sourcify может показать тот прежний исходник. «exact match» невозможен при `bytecode_hash = none`; ожидаемый результат — `"match"`. [игра, 2026]
- Деплой игры стоил 1,49 MON при 115 gwei для контракта в 42 873 байта; контракты кита намного меньше. Оценка forge показывает примерно вдвое больше реальной цены (считает по max fee). [игра, 2026]
- Живой NameRegistry игры `0xe14b1389853aD407A5B72193Ae3Bd1bb35602525` (деплой 2 ноя 2026, Sourcify match) имеет тот же ABI, что NameRegistry кита (тот же исходник, старый компилятор); деплой на базе кита может использовать его вместо собственного. [игра, 2 ноя 2026]
