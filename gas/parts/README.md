# parts — 貼らなくてよいファイル

ここにあるのは **`../002-Extras.gs` を組み立てるための材料** です。
Apps Script に貼るのは、ひとつ上の階層にある3つだけです。

| ファイル | 中身 | 行き先 |
|---|---|---|
| `Strategy.gs` | 立ち回り分析＋ロングマップ | `002-Extras.gs` に束ねられる |
| `Opucha.gs` | オプチャ印を付ける／外す画面 | `002-Extras.gs` に束ねられる |
| `ChartFit.gs` | グラフをZ列の幅にそろえる | `002-Extras.gs` に束ねられる |
| `MapLink.gs` | G列の乗り場名 → Googleマップ | **まだどこにも入っていない**（未導入） |

`Strategy.gs` / `Opucha.gs` / `ChartFit.gs` を直したら、必ず組み立て直します。

```
python3 tools/build_extras.py
```

`MapLink.gs` だけは束ねていません。使うときは、そのまま Apps Script に
新しいファイルとして追加します（詳しくは `../README.md`）。
