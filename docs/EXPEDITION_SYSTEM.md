# 冒険者の遠征システム — 設計提案

更新日: 2026-09-13

対象: Dungeon Curio Merchant / Merchan のWeb版

状態: 設計提案。実装着手・数値の確定を意味しない。[STORY_SYSTEM_ROADMAP.md](STORY_SYSTEM_ROADMAP.md) §7「次の設計単位: 冒険者の遠征」の9項目に答える文書として書いた。

前提: [CORE_STORY.md](CORE_STORY.md)・[INTRO_SCENARIO.md](INTRO_SCENARIO.md) の2026-09-13更新（迷宮の発見が導入の後半まで来ないこと、攻略後に町が戻らないこと）を踏まえる。また、装備の「託す」一本化と、売買した品が画面外の生死に効く仕組み（`merchantOrigin`）は、未マージの `feat/merchant-goods-entrustment` ブランチを土台にする。本書はそのブランチの型・関数名で書く。マージ前に本設計へ着手する場合は、`main` の `NpcGearTerm` 版に合わせて読み替える。

## 1. 今のコードで確認した現状

| 項目 | 現状 | 参照 |
|---|---|---|
| 出発の単位 | `NpcRecord.delve = { floor, departedDay }`。**1日で必ず決着する。** 目標階も `preferredDelveFloor` が出発のたびに引き直すだけで、前日の続きという概念がない | [townDay.ts](../src/game/townDay.ts) `simulateTownDay` / `finishDelve` / `preferredDelveFloor` |
| 商人の同伴 | `beginExpedition` は商人自身の潜行で、1日に1回しか出発できない（`lastExpeditionDay === state.day` で弾く）。ただし潜行そのものは `consumeDungeonTime` 経由で複数日にまたがれる —— これは既に動いていて、テスト済み | [engine.ts](../src/game/engine.ts) `canBeginExpedition` / `beginExpedition`。[playerKnowledge.test.ts](../src/game/playerKnowledge.test.ts) の複数日テスト |
| 商人が同伴しない支援 | 装備の託し（`entrustGear`）と販売はあるが、**それが「何日、どこまで」の計画に結びつく仕組みがない。** 託した瞬間から翌日以降の `finishDelve` に混ざるだけ | [npcGear.ts](../src/game/npcGear.ts) |
| 公表と実際の分離 | 死亡は既に分離されている（`knowsNpcDeath` を序列表が読む、[adventurerRanking.ts](../src/game/adventurerRanking.ts)）。**潜行中の階数は分離されていない** —— `adventurerStanding` が `npc.delve.floor`（世界の真値）をそのまま「地下N階へ潜行中」と表示する | [adventurerRanking.ts:76](../src/game/adventurerRanking.ts) |
| 画面外との同時処理 | `partyAndFloorNpcIds`（[townDay.ts:79-89](../src/game/townDay.ts)）は現在階だけでなく、**訪問済みの `floorStates` にいるNPCも既に日次処理から除外している。** ただしこの除外は「`state.run` が存在する間ずっと」続くため、商人が長く潜り続けるほど、途中で行き合った冒険者が長く足止めされる（後述） | [townDay.ts](../src/game/townDay.ts) |
| 帰宅時の引き継ぎ | `returnHome` は生還者の負傷だけを `NpcRecord` へ書き戻し、状態を `inTown` へ戻す処理は**翌朝の町シミュレーションに委ねる**（コメントに明記）。つまり `state.run` が消えた直後の一日は、まだ出発時の古い目標階のまま `finishDelve` が決着する | [engine.ts:1746-1747, 1799](../src/game/engine.ts) |
| 期日つきの約束 | `BulkOrder` に納期・違約金・借金にしない清算の先例がある。遠征の「予定日」「未達の扱い」はこの形をなぞれる | [bulkOrders.ts](../src/game/bulkOrders.ts) |

まとめると、**世界時計・事実と知識の分離・借金を作らない原則は既にあるので、遠征に新しく必要なのは「複数日にまたがる計画」と「その計画の公表範囲」の2つだけである。**

## 2. 設計の軸

1. **一般化する。分岐させない。** 既存の `npc.delve`（1日で決着）と、これから作る複数日の計画を、別々の日次ループにしない。1日決着は「計画日数1の遠征」という特殊形にする。二重の処理経路を持たせると、[4.3](STORY_SYSTEM_ROADMAP.md#43-遠征と主人公の探索) が警告する二重死亡・二重処理の温床になる。
2. **商人が同伴する護衛と、同伴しない支援は別の契約のまま。** `EscortCommission` / `ActiveGuard` は変更しない。今回の対象は、商人が家に残り、誰かに任せて送り出す遠征だけである。
3. **初回は1人・一往復。** パーティ結成、日次の継続/撤退判断、救助依頼はすべて次回以降に回す。型は将来の拡張を妨げない形にするが、今回実装するのは単数形だけである。
4. **公表は「頼んだ日に決めた計画」と「その後届いた報告」だけで組む。** 世界の真値（実際に到達した階、内部の生死）を画面へ直接渡さない —— これは死亡表示で既に守られている原則を、潜行中の表示にも広げるだけである。

## 3. データモデル

`NpcRecord.delve` を `NpcRecord.expedition` へ一般化する。

```ts
export interface Expedition {
  /** 報告IDに使う。`expedition-${npcId}-${departedDay}` で足りる（1人1回のみ有効なため）。 */
  id: string;
  npcId: string;
  departedDay: number;
  /** 出発時に決め、以後は書き換えない。掲示が読んでよいのはここまで。 */
  declaredFloor: number;
  plannedDays: number;
  /** 商人が出発前に支援したときだけ持つ。自発的な出発には無い。 */
  backing?: ExpeditionBacking;
  /** ここから下は世界の真値。掲示・報告生成以外のコードから直接読まない。 */
  reachedFloor: number;
  settledDay?: number;
  outcome?: "returned" | "injured" | "died";
}

export interface ExpeditionBacking {
  /** 借金にしない。渡した時点で商人の手を離れる。 */
  fundedProvisions: number;
  /** entrustGear で託した、または売って merchantOrigin が付いた品のうち、この遠征のために渡したもの。 */
  suppliedItemIds: string[];
}
```

`plannedDays` を持たない旧 `delve` はそのまま `plannedDays: 1` に畳めるので、**自発的な出発（`shouldDepart` のロール）は今までどおり `plannedDays: 1` の遠征として作られる。** 変わるのは名前と、後述の決着タイミングの一般化だけで、既存の30人規模の背景シミュレーションは数式・頻度とも変更しない。

商人が支援して複数日を計画するのは、新しい入口（護衛募集の隣、「遠征を支援する」）から明示的に始めたときだけである。

## 4. §7の9項目への回答

### 出発の理由

自発的な出発（`shouldDepart`）は変更しない。商人が支援するときだけ、以下を新しく決める。

- 対象は `isAvailableInTown` かつ `expedition` を持たない冒険者に限る（護衛と二重に契約できない。既存の `postEscortCommission` と同じ排他ルール）
- 商人が `declaredFloor` を提示し、本人がそれを受けるかどうかを `assessGuardDescent` と同じ形の危険度式で判定する。危険すぎれば断る —— 「本人の判断の余地」はここに置く
- 断られても損はない。承諾されて初めて支援（金・薬・装備）が渡る

### パーティ

**今回は対象外。** `npcId: string` は単数のまま実装する。複数人の遠征、既存の1人護衛との共存ルールは、B-2（荷担ぎと相互監視、保留中）の再検討と合わせて次回以降に回す。型を `participantIds: string[]` に広げるのは、実際に2人目の需要が出てからでよい。

### 計画

- `declaredFloor`：商人が提示し、本人が承諾した階。出発後は書き換えない
- `plannedDays`：`declaredFloor` が本人の推奨階（`ADVENTURER_RANKS[rank].recommendedFloor`）をどれだけ超えるかで決まる目安日数（例: 超過0〜1日なら1日、超過が増えるごとに1日ずつ延ばす）。数値はここで固定しない
- 商人へ伝わる範囲は `declaredFloor` と `plannedDays` だけ。`reachedFloor` は伝わらない

### 補給と購入

- 装備：`entrustGear` をそのまま使う（[feat/merchant-goods-entrustment](https://github.com/eigamaker/merchant/pull/new/feat/merchant-goods-entrustment) の「託す」一本化後の形）。渡した装備は `gearPower` を通じて既存の生存式にそのまま乗る —— 新しい読み取り経路は要らない
- 薬：店売り・直接売りで `merchantOrigin` が付いた薬をそのまま使う。多チャージの薬が際どい死を一度肩代わりする挙動（同ブランチの `MEDICINE_SAVE_BAND`）は遠征でも変更なしで効く
- 食料：`fundedProvisions` は実在庫のシミュレーションではなく、**「これだけ持たせたので、これだけの日数を計画してよい」という粗い許可証**にとどめる。NPCの携行食料を1個ずつ消費させる仕組みは今回作らない。理由は主人公の食料経済（`PROVISIONS_PER_SLOT` / `dungeonMealProvisionCost`）をそのまま横流しすると、30人規模の背景シミュレーションにも波及して肥大化するため
- 出資：金銭だけを渡す形は今回は作らない。渡すのは品（装備・薬・食料の許可証）のみとし、C-2「信用と借金は作らない」を額面の出資でも壊さないようにする

### 日次の判断

**今回は1回の判定に絞る。** 前進・撤退・野営を毎日プレイヤーに問う仕組みは作らない。`departedDay + plannedDays` に達した日に、既存の `resolveDelveOutcome` と同じ式を1回だけ引く（入力は `declaredFloor`）。前進・撤退の分岐は、この一往復が確認できてから次の段階で足す。

### 商人の支援

- **護衛契約とは別の契約。** 商人が同伴する護衛は `EscortCommission` のまま変更しない。遠征支援は「商人が家に残り、送り出す」ときだけに使う契約で、同じ人物に同時に両方は成立しない
- 支援の効き方は「装備・薬は生存式に乗る」「計画日数の許可が深い階を狙えるようにする」の2点だけで、的中率を直接操作する専用の係数は置かない —— 既存の式を素直に使う

### 帰還・未帰還

- 決着は `departedDay + plannedDays` に固定する。人為的な遅延は入れない。**理由**: 商人自身が地下に長く留まる、あるいは同じ日に届く報せが多くて日誌へ回されるなど、既存の配信の遅れだけで「予定日を過ぎてもまだ聞いていない」状態は十分に起こる。仕組みを二重に作らない
- 掲示（`adventurerStanding`）は `state.day` と `departedDay + plannedDays` を比較できる。予定日を過ぎても訃報・帰還のどちらも届いていなければ「帰還遅延」と表示する。この比較に必要な日付はプレイヤー自身が支援時に知った計画なので、新しい情報配信は要らない
- 生還時は新しく報告を1件積む（`queueReport`、`reach: "town"`）。**今は生還が無報告のため**、支援の手応えが返ってくる場面が無い。死亡時は既存の `recordOffscreenDeath` をそのまま使う（`merchantOrigin` により「託した」「売った」を言い分ける文面は同ブランチで対応済み）
- 救助依頼：**対象外。** B-4「救助を呼ぶ道具は作らない」との整合を保つ

### 情報と時間

- 出発時の計画は商人自身が決めるので、配信を要らない（自分で知っている）
- 決着の報告は既存の `TimedEvent → InformationReport → PlayerKnowledge` の経路にそのまま乗せる。地下にいれば町に着くまで届かない、という既存動作を変更しない
- 支援した遠征は、装備を託した・薬を売った時点で必ず縁（`recordBond`）が生まれているため、**結果は必ず報告される。** 見知らぬ背景NPCの生還が無報告のままなのは変えない —— 全員の毎日を逐一報告すると日誌が埋まる

### 保持と再現

- `Expedition` は `NpcRecord.expedition` に1件だけ持つ（同時に2件は作れない）
- 決着判定は `${campaignId}:${departedDay}:expedition:${npcId}:...` の形でハッシュする。既存の `roll()` と同じ規則で、セーブを読み直しても同じ日に同じ結果が出る
- 訪問済み階に残ったまま長く足止めされる問題は、次節で個別に扱う

## 5. 責任境界 —— 訪問済み階でのフリーズを直す

`partyAndFloorNpcIds`（[townDay.ts:79-89](../src/game/townDay.ts)）は現在階だけでなく `floorStates` の全階を見ているので、**同じNPCを画面外の日次処理と同時に動かす二重処理は、今の実装でも起きない。** ここは既に安全である。

ただし副作用がある。`returnHome` のコメントが明言するとおり、生還者の状態を `inTown` へ戻すのは**帰宅翌朝の町シミュレーション**であり、`state.run` が存在する間はずっと除外され続ける。商人の潜行が長くなるほど、道中で行き合った冒険者は長く足止めされ、しかも `finishDelve` が最終的に読むのは**出発時に決まった `declaredFloor`**であって、実際にその冒険者と行き合った階ではない。

複数日の遠征を導入すると、商人自身の潜行も長くなりやすいので、この差が今より目立つ。対応は次の一点に絞る。

> **画面上でその冒険者に行き会うたびに、`expedition.reachedFloor` をその場の階へ同期する。** `selectFloorDelvers`（新規に階へ現れたとき）と `dungeonTraffic.ts` の `admit`（途中から入ってきたとき）の2箇所に、代入を1行足すだけでよい。

これにより、足止めが解けたときの決着が、出発時の古い目標ではなく、実際に見た場所を反映する。**足止めそのもの**（行き合っている間は歳を取らない）は今回は許容する —— 画面に映っている以上、その間生きているのは自明であり、無理に同時並行のシミュレーションを組む必要はない。長期化を狙って複雑にするのは次の段階でよい。

## 6. §8の受け入れ例との対応

[STORY_SYSTEM_ROADMAP.md §8](STORY_SYSTEM_ROADMAP.md#8-将来の実装で確かめる場面) の例が、本設計でどう成立するかを確認する。

| 例 | 成立の根拠 |
|---|---|
| 1. 不在中の更新 | `Expedition` の決着は `simulateTownDay` の中で日ごとに判定されるので、商人が地下にいても`state.day` が進むたびに一度だけ判定される。既存の `applyDueWorldEvents` と同じ「世界は待たない、配信は待つ」原則をそのまま使う |
| 2. 到達と公表 | `reachedFloor` は生還報告が届くまで掲示に出さない。到達した日と報告が届いた日を `TimedEvent.dueDay` と `KnownReport.learnedDay` で分けて残す（既存の型のまま） |
| 3. 全滅と未帰還 | 予定日超過かつ死を未確認なら「帰還遅延」。`knowsNpcDeath` が真になって初めて掲示が変わる。内部の `outcome === "died"` を直接読む経路を増やさない |
| 4〜5. 事件・目撃・噂 | 今回のスコープでは新設しない（S-8「情報の経路と、遅れと誤り」の対象）。今回は成功・死亡の二値だけを配る |
| 6. 剣を取らない選択 | 本設計と無関係（プロローグ側の話）。`Expedition` は本編開始後の仕組みなので干渉しない |
| 7. 支援の手応え | 生還報告を新設したことで、装備・薬を渡した結果が言葉で返ってくる。持っているだけの品を装備扱いしない原則は `merchantOrigin` 側で既に守られている |
| 8. 中断と保持 | `expedition` は1人1件のみ、決着はハッシュで再現可能、セーブの二重処理は `lastSimulatedDay` の既存ガードがそのまま効く |

## 7. 保存と移行

- `NpcRecord.delve` を `NpcRecord.expedition` へ改名する。既存の `{ floor, departedDay }` は `{ id: "expedition-<npcId>-<departedDay>", npcId, departedDay, declaredFloor: floor, plannedDays: 1, reachedFloor: floor }` に機械的に変換できる（`backing` は無し、`outcome` は無し = 未決着のまま引き継ぐ）
- バージョンは、[feat/merchant-goods-entrustment](https://github.com/eigamaker/merchant/pull/new/feat/merchant-goods-entrustment) の v16 が先にマージされる前提で v17 とする。まだマージされていない状態でこちらから着手する場合は、その版の移行と競合しないよう先にマージ順を決める
- `pruneCampaignRecords` の保持対象に `expedition.backing?.suppliedItemIds` を加える。未決着の遠征に渡した装備・薬を、探索と無関係な剪定で消さない

## 8. 今回は作らないもの

- パーティ（複数人の遠征）— B-2 と合わせて次回
- 日次の継続/撤退判断 — 一往復が検証できてから
- 実消費される携行食料のNPCシミュレーション — 粗い許可証で代替
- 救助依頼 — B-4 の判断を維持
- 出資の金銭化・借金 — C-2 の判断を維持
- 噂・誤情報の経路（S-8）— 今回は成功／死亡の二値報告のみ

## 9. 実装順の提案

1. `NpcRecord.delve` → `expedition` の改名とセーブ移行（挙動は変えない一段）
2. `advanceExpeditions` を `simulateTownDay` の中へ切り出し、`plannedDays: 1` の自発的出発が今までと同じ結果になることをテストで固定する
3. 訪問済み階での `reachedFloor` 同期（§5）
4. 支援の入口（UI・`backExpedition` 相当の関数）と `declaredFloor` / `plannedDays` の決定式
5. 生還報告の新設
6. 掲示（`adventurerStanding`）の「帰還遅延」表示

各段で `npm test` と `npm run build` を通し、既存の30人規模の背景シミュレーションのテスト（[townDay.test.ts](../src/game/townDay.test.ts)）が崩れていないことを都度確認する。
