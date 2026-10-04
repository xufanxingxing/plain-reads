# plain-reads

Annotated editions of technical articles. The original text is left untouched; after each logical paragraph there is a dashed annotation box with four parts: what the passage is doing, terms, a Chinese translation, and an example. The goal is to read an article once, top to bottom, and understand it without looking anything up.

Each article is a single self-contained HTML file. Read it online through the links below, or download it and open it in a browser.

## Contents

| Article | Source | Author | License |
|---|---|---|---|
| [Reward Modeling](https://xufanxingxing.github.io/plain-reads/rlhf-book/05-reward-models.html) | [RLHF Book, Chapter 5](https://rlhfbook.com/c/05-reward-models) | Nathan Lambert | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

## Comments

On the hosted pages, select any text to leave a comment; comments float in the right margin next to the text they refer to. They are stored in Supabase: `supabase/comments.sql` creates the table and the functions that write to it, and the project's publishable key goes in `assets/comments.js`. Without a key, comments stay in the reader's own browser. A downloaded page has no comments.

## License

Each annotated edition keeps the license of its source. Attribution, a link to the original, and a note on what was changed are in the footer of each page. The added annotations, translations, summaries, and glossaries are shared under the same license.
