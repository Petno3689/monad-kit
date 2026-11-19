# Деплой monad-kit на Monad testnet

Руководство для владельца, Windows, PowerShell. Все команды `forge`/`cast` — из папки `contracts/`. Приватный ключ **никогда** не отправляется ревьюеру и не попадает в репозиторий: подпись только через зашифрованный keystore Foundry (`--account <name>`).

Факты (адреса, лимиты, Sourcify) — в [MONAD-PYTH.md](MONAD-PYTH.md).

## 0. Подготовка

```powershell
cd C:\Users\1\Desktop\LNP-Monad\monad-kit\contracts
$F = "C:\Users\1\Desktop\LNP-Monad\.tools\foundry-win"
& "$F\forge.exe" build
& "$F\forge.exe" test
```

`forge test` должен пройти целиком. Скрипты деплоя отказываются работать на любой сети, кроме 10143.

## 1. Keystore (один раз)

```powershell
& "$F\cast.exe" wallet import monad-deployer --interactive
```

Ключ вводится в запросе (не в командной строке), затем пароль keystore. Не `--interactive 1` и не `--private-key`: на Foundry 1.8.3 `--interactive 1` ломается («encode length mismatch»). Имя `monad-deployer` — пример; подставьте своё в `--account` ниже.

## 2. Баланс

```powershell
& "$F\cast.exe" wallet address --account monad-deployer
& "$F\cast.exe" balance <ADDRESS> --rpc-url https://testnet-rpc.monad.xyz --ether
```

Деплой кита стоит малую долю того, что стоил деплой игры (1,49 MON за контракт в 42 873 байта; контракты кита намного меньше). Оценка forge примерно вдвое выше реальной цены. Faucet: https://faucet.monad.xyz.

## 3. Dry run (без отправки)

```powershell
& "$F\forge.exe" script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --account monad-deployer
```

Без `--broadcast` ничего не отправляется. В логе проверьте: chain id 10143, Entropy `0x825c0390…3c07`, провайдер `0x6CC14824…6344`, callback gas limit 1000000, таймауты 120 и 600.

## 4. Деплой Deploy.s.sol

```powershell
& "$F\forge.exe" script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --account monad-deployer --broadcast
```

Из вывода запишите адреса `PythEntropySource` и `ChestGame`.

## 5. NameRegistry — два варианта

**A. Свой реестр** (чистый, без чужих ников):

```powershell
& "$F\forge.exe" script script/DeployNames.s.sol --rpc-url https://testnet-rpc.monad.xyz --account monad-deployer --broadcast
```

**B. Реестр игры** `0xe14b1389853aD407A5B72193Ae3Bd1bb35602525` (деплой 2 ноя 2026, Sourcify match; тот же ABI). Деплоить и верифицировать ничего не нужно.

Компромисс: в варианте B ники общие с игрой (имя, занятое там, занято и у вас), в варианте A реестр пустой и полностью ваш, но он стоит деплоя и верификации.

## 6. Верификация

Аргументы конструктора (подставьте реальные адреса):

```powershell
# PythEntropySource
& "$F\cast.exe" abi-encode "constructor(address,address,uint32)" 0x825c0390f379C631f3Cf11A82a37D20BddF93c07 0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344 1000000

# ChestGame
& "$F\cast.exe" abi-encode "constructor(address,uint32,uint32)" <PYTH_ENTROPY_SOURCE_ADDRESS> 120 600
```

Верификация (Sourcify на Monad), для каждого контракта:

```powershell
& "$F\forge.exe" verify-contract <PYTH_ENTROPY_SOURCE_ADDRESS> src/PythEntropySource.sol:PythEntropySource --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args <ENCODED_ARGS>
& "$F\forge.exe" verify-contract <CHEST_GAME_ADDRESS> src/ChestGame.sol:ChestGame --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ --constructor-args <ENCODED_ARGS>
& "$F\forge.exe" verify-contract <NAME_REGISTRY_ADDRESS> src/NameRegistry.sol:NameRegistry --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Последняя команда — только для варианта A (у NameRegistry нет аргументов конструктора).

Проверка результата:

```powershell
Invoke-RestMethod "https://sourcify-api-monad.blockvision.org/v2/contract/10143/<ADDRESS>"
```

Ожидается `match` (не `exact match`: при `bytecode_hash = none` он невозможен). Эндпоинт `/check-by-addresses` не использовать — он отвечает false и для верифицированных контрактов.

## 7. Приложение

1. Сначала создайте проект на Vercel: Root Directory `app`; приложение импортирует `../shared` через алиас `@shared`, поэтому опция «include files outside the root directory» должна остаться включённой; CSP берётся из `app/vercel.json` (`connect-src` — только RPC Monad). Первый деплой работает и с пустыми адресами.
2. Возьмите `APP_ORIGIN` из домена, который Vercel реально показывает для проекта (Project → Settings → Domains), в том виде, как его даёт `location.origin` в браузере: `https://<domain>`, без завершающего слэша. Заранее не угадывайте.
3. Одним изменением: задайте `CHEST_GAME_ADDRESS`, `NAME_REGISTRY_ADDRESS` и `APP_ORIGIN` в `app/src/config.ts` и обновите ожидаемый текст `SESSION_MESSAGE` в `app/src/config.test.ts` (он содержит origin: «Sign only on http://localhost:5173 - …»). Vercel передеплоит из `main`.
4. Только после этого можно пополнять игровой ключ: `APP_ORIGIN` входит в подписываемое сообщение, его смена меняет все ключи.
5. `OPEN_GAS_FALLBACK` после деплоя измеряет ревьюер: газ `open()` на testnet он замеряет сам (с mock-Pyth `open()` — 209 406 газа, настоящий запрос Pyth дороже). Не меняйте значение наугад.

## 8. Чего не делать

- Не отправлять приватный ключ или пароль keystore ревьюеру, в чат или в репозиторий.
- Не использовать адрес Entropy из страницы oracle документации Monad (см. предупреждение в [MONAD-PYTH.md](MONAD-PYTH.md)).
- Не менять `APP_ORIGIN` после того, как ключи уже пополнены.
