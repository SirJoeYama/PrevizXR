import { sceneCredits } from '../assets/credits';
import type { Editor } from '../model/Editor';
import { el, section } from './dom';

/** Lists attributions; CC-BY requires crediting the author wherever renders are published. */
export class CreditsPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly editor: Editor) {
    this.list = el('ul', { class: 'credits' });
    this.root = section(
      'Credits',
      'sb-credits',
      el('p', { class: 'hint', text: 'CC-BY models require crediting the author wherever you publish renders made with them.' }),
      this.list,
    );
    editor.subscribe((c) => c === 'doc' && this.render());
    this.render();
  }

  private render(): void {
    const credits = sceneCredits(this.editor.doc);
    this.list.replaceChildren(
      ...(credits.length
        ? credits.map((c) =>
            el('li', {}, el('a', { href: c.url, target: '_blank', rel: 'noopener', text: c.title }), ` by ${c.author} (${c.licence})`),
          )
        : [el('li', { class: 'hint', text: 'No third-party models in this scene.' })]),
    );
  }
}
