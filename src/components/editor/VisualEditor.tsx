import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Plus, Download, FileText, ArrowDown, ArrowUp, Trash2, Copy, FolderOpen, ImagePlus, Monitor, Redo2, Smartphone, Tablet, Undo2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { deleteProjectAssetFile, generateImages, getProjectAssets, ProjectAsset, uploadProjectAssets, uploadProjectAssetsFromUrls, getProjectFiles, uploadProjectFiles, deleteProjectFile } from '@/services/api';
import { downloadFileFromUrl } from '@/lib/downloadFile';
import { safeGetJSON, safeSetJSON } from '@/lib/safeStorage';
import { toast } from 'sonner';


const HISTORY_LIMIT = 60;
const SNAPSHOT_LIMIT = 12;
const TEXT_EDITABLE_TAGS = new Set([
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'label',
  'strong',
  'em',
  'small',
  'li',
  'blockquote',
  'button',
  'figcaption',
  'td',
  'th',
]);

const PREDEFINED_SECTIONS = [
  { name: 'Hero', label: 'Hero', icon: <Plus size={16} /> },
  { name: 'Benefits', label: 'Benefits', icon: <Plus size={16} /> },
  { name: 'Social Proof', label: 'Social Proof', icon: <Plus size={16} /> },
  { name: 'CTA', label: 'CTA', icon: <Plus size={16} /> },
  { name: 'Form', label: 'Form', icon: <FileText size={16} /> },
  { name: 'Download', label: 'Download', icon: <Download size={16} /> },
  { name: 'Embedded', label: 'Embedded', icon: <FileText size={16} /> },
];

type SelectedNode = {
  path: string;
  sectionPath: string | null;
  tag: string;
  text: string;
  fontFamily: string;
  lineHeight: string;
  whiteSpace: string;
  overflowWrap: string;
  wordBreak: string;
  textWrap: string;
  src: string;
  objectFit: string;
  objectPosition: string;
  width: string;
  minWidth: string;
  height: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  aspectRatio: string;
  href: string;
  target: string;
  rel: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  paddingTop: string;
  paddingBottom: string;
  marginTop: string;
  marginBottom: string;
  fontSize: string;
  fontWeight: string;
  textAlign: string;
  borderRadius: string;
  isButtonLike: boolean;
};

type VisualEditorProps = {
  html: string;
  onChange: (nextHtml: string) => void;
  saving?: boolean;
  projectId?: number | null;
  userId?: number | null;
  projectPublicUrl?: string;
  brandPalette?: string[];
  /** 'split' = iframe left + panel right (default); 'overlay' = iframe full-screen + floating toggle panel */
  layout?: 'split' | 'overlay';
};

type OverlayMode = 'none' | 'color' | 'gradient' | 'dark' | 'mask';

type EditorSnapshot = {
  id: number;
  label: string;
  html: string;
  createdAt: number;
};

const EDITOR_MESSAGE_SOURCE = 'chiliforge-visual-editor';

const BRIDGE_STYLE_CONTENT = '.cf-editor-hover{outline:2px dashed #f97316 !important; outline-offset:2px !important; cursor:pointer !important;}\n.cf-editor-selected{outline:3px solid #ea580c !important; outline-offset:2px !important;}';

const BRIDGE_SCRIPT_CONTENT = `(function(){
  var SOURCE='${EDITOR_MESSAGE_SOURCE}';
  function indexInType(el){
    var i=1; var p=el;
    while((p=p.previousElementSibling)){ if(p.tagName===el.tagName){ i++; } }
    return i;
  }
  function cssPath(el){
    if(!el || el===document.documentElement){ return 'html'; }
    var parts=[];
    var node=el;
    while(node && node.nodeType===1 && node!==document.body){
      var tag=node.tagName.toLowerCase();
      var idx=indexInType(node);
      parts.unshift(tag+':nth-of-type('+idx+')');
      node=node.parentElement;
    }
    return 'body > '+parts.join(' > ');
  }
  function closestSectionPath(el){
    var section = el.closest('section');
    return section ? cssPath(section) : null;
  }
  function getInfo(el){
    var cs=window.getComputedStyle(el);
    return {
      path: cssPath(el),
      sectionPath: closestSectionPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 500),
      fontFamily: cs.fontFamily || '',
      lineHeight: cs.lineHeight || '',
      whiteSpace: cs.whiteSpace || '',
      overflowWrap: cs.overflowWrap || '',
      wordBreak: cs.wordBreak || '',
      textWrap: cs.textWrap || '',
      src: el.getAttribute('src') || '',
      objectFit: cs.objectFit || 'fill',
      objectPosition: cs.objectPosition || '50% 50%',
      width: cs.width || '',
      minWidth: cs.minWidth || '',
      height: cs.height || '',
      minHeight: cs.minHeight || '',
        maxWidth: cs.maxWidth || '',
        maxHeight: cs.maxHeight || '',
        aspectRatio: cs.aspectRatio || '',
        href: el.getAttribute('href') || '',
      target: el.getAttribute('target') || '',
      rel: el.getAttribute('rel') || '',
      color: cs.color || '',
      backgroundColor: cs.backgroundColor || '',
      backgroundImage: cs.backgroundImage || '',
      backgroundSize: cs.backgroundSize || '',
      backgroundPosition: cs.backgroundPosition || '',
      backgroundRepeat: cs.backgroundRepeat || '',
      paddingTop: cs.paddingTop || '0px',
      paddingBottom: cs.paddingBottom || '0px',
      marginTop: cs.marginTop || '0px',
      marginBottom: cs.marginBottom || '0px',
      fontSize: cs.fontSize || '16px',
      fontWeight: cs.fontWeight || '400',
      textAlign: cs.textAlign || 'left',
      borderRadius: cs.borderRadius || '0px',
      isButtonLike: el.tagName === 'BUTTON' || el.tagName === 'A'
    };
  }
  function postSelect(el){
    try {
      window.parent.postMessage({ source: SOURCE, type: 'select', payload: getInfo(el) }, '*');
    } catch (e) {}
  }
  var lastHover = null;
  var lastSelected = null;
  document.addEventListener('mouseover', function(ev){
    var t=ev.target;
    if(!(t instanceof Element)) return;
    if(lastHover && lastHover!==lastSelected){ lastHover.classList.remove('cf-editor-hover'); }
    if(t !== lastSelected){ t.classList.add('cf-editor-hover'); lastHover=t; }
  }, true);
  document.addEventListener('mouseout', function(){
    if(lastHover && lastHover!==lastSelected){ lastHover.classList.remove('cf-editor-hover'); }
  }, true);
  document.addEventListener('click', function(ev){
    var t=ev.target;
    if(!(t instanceof Element)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if(lastSelected){ lastSelected.classList.remove('cf-editor-selected'); }
    if(lastHover){ lastHover.classList.remove('cf-editor-hover'); }
    lastSelected=t;
    t.classList.add('cf-editor-selected');
    postSelect(t);
  }, true);
})();`;

const rgbToHex = (value: string) => {
  if (!value) return '#111111';
  if (value.startsWith('#')) return value;
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return '#111111';
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

const parseColorWithAlpha = (value: string) => {
  if (!value) return { hex: '#ffffff', alpha: 100 };
  if (value.startsWith('#')) return { hex: value, alpha: 100 };
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) return { hex: '#ffffff', alpha: 100 };
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const a = Math.max(0, Math.min(1, Number(match[4] ?? '1')));
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  return { hex, alpha: Math.round(a * 100) };
};

const hexToRgba = (hex: string, alphaPercent: number) => {
  const safe = (hex || '#ffffff').replace('#', '');
  const full = safe.length === 3
    ? safe.split('').map((c) => c + c).join('')
    : safe.padEnd(6, 'f').slice(0, 6);
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const a = Math.max(0, Math.min(100, alphaPercent)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const normalizePublicBaseUrl = (value?: string) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
  return normalized;
};

const buildAssetsFolderUrl = (value?: string) => {
  const base = normalizePublicBaseUrl(value);
  if (!base) return '';
  return `${base}assets/`;
};

const buildAssetUrlCandidates = (rawUrl: string, projectUrl?: string, assetsUrl?: string, assetName?: string) => {
  const raw = (rawUrl || '').trim();
  const name = (assetName || '').trim();
  const candidates: string[] = [];

  const assetsBase = (assetsUrl || '').trim();
  const projectBase = normalizePublicBaseUrl(projectUrl);

  try {
    const absoluteProjectBase = projectBase
      ? new URL(projectBase, window.location.origin).toString()
      : '';
    const absoluteAssetsBase = assetsBase
      ? new URL(assetsBase, absoluteProjectBase || window.location.origin).toString()
      : '';
    const origin = absoluteProjectBase
      ? new URL(absoluteProjectBase).origin
      : window.location.origin;

    // Canonical candidate: assets base + filename from listing.
    if (name && absoluteAssetsBase) {
      candidates.push(new URL(encodeURIComponent(name), absoluteAssetsBase).toString());
    }

    if (raw && /^(data:|blob:|https?:\/\/)/i.test(raw)) {
      candidates.push(raw);
    }

    if (raw && raw.startsWith('/')) {
      candidates.push(new URL(raw, origin).toString());
    }

    if (raw && absoluteAssetsBase) {
      candidates.push(new URL(raw, absoluteAssetsBase).toString());
    }

    if (raw && absoluteProjectBase) {
      candidates.push(new URL(raw, absoluteProjectBase).toString());
    }
  } catch {
    // handled by fallbacks below
  }

  if (raw) candidates.push(raw);

  if (name && assetsBase) {
    const normalizedBase = assetsBase.endsWith('/') ? assetsBase : `${assetsBase}/`;
    candidates.push(`${normalizedBase}${encodeURIComponent(name)}`);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveAssetUrl = (rawUrl: string, projectUrl?: string, assetsUrl?: string, assetName?: string) => {
  const candidates = buildAssetUrlCandidates(rawUrl, projectUrl, assetsUrl, assetName);
  return candidates[0] || '';
};

const resolveNextAssetUrlCandidate = (currentUrl: string, rawUrl: string, projectUrl?: string, assetsUrl?: string, assetName?: string) => {
  const current = (currentUrl || '').trim();
  const candidates = buildAssetUrlCandidates(rawUrl, projectUrl, assetsUrl, assetName);
  return candidates.find((candidate) => candidate !== current) || '';
};

const buildFilesFolderUrl = (value?: string) => {
  const base = normalizePublicBaseUrl(value);
  if (!base) return '';
  return `${base}files/`;
};

const parseLinearGradient = (value: string) => {
  const raw = (value || '').trim();
  if (!/linear-gradient\(/i.test(raw)) return null;
  const angleMatch = raw.match(/(-?\d+(?:\.\d+)?)deg/i);
  const colors = raw.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || [];
  if (colors.length < 2) return null;
  return {
    angle: Math.round(Number(angleMatch?.[1] ?? '135')),
    c1: parseColorWithAlpha(colors[0]),
    c2: parseColorWithAlpha(colors[1]),
  };
};

const composeBackgroundImageWithOverlay = (params: {
  imageUrl: string;
  overlayMode: OverlayMode;
  overlayColor: string;
  overlayOpacity: number;
  overlayGrad1: string;
  overlayGrad2: string;
  overlayAngle: number;
  darkOpacity: number;
}) => {
  const image = (params.imageUrl || '').trim();
  if (!image) return '';

  const overlayMode = params.overlayMode || 'none';
  if (overlayMode === 'none') {
    return `url('${image}')`;
  }

  if (overlayMode === 'gradient') {
    return `linear-gradient(${params.overlayAngle}deg, ${hexToRgba(params.overlayGrad1, params.overlayOpacity)} 0%, ${hexToRgba(params.overlayGrad2, params.overlayOpacity)} 100%), url('${image}')`;
  }

  if (overlayMode === 'dark') {
    const dark = Math.max(0, Math.min(100, params.darkOpacity));
    return `linear-gradient(${hexToRgba('#000000', dark)}, ${hexToRgba('#000000', dark)}), url('${image}')`;
  }

  if (overlayMode === 'mask') {
    return `linear-gradient(${hexToRgba(params.overlayColor, Math.max(0, Math.min(100, Math.round(params.overlayOpacity * 0.7))))}, ${hexToRgba(params.overlayColor, params.overlayOpacity)}), url('${image}')`;
  }

  return `linear-gradient(${hexToRgba(params.overlayColor, params.overlayOpacity)}, ${hexToRgba(params.overlayColor, params.overlayOpacity)}), url('${image}')`;
};

const toPxNumber = (value: string, fallback = 0) => {
  const n = Number.parseFloat((value || '').replace('px', '').trim());
  return Number.isFinite(n) ? n : fallback;
};

const parsePositionKeyword = (value: string) => {
  const lower = (value || '').toLowerCase().trim();
  if (!lower) return { x: 50, y: 50 };

  const mapX: Record<string, number> = { left: 0, center: 50, right: 100 };
  const mapY: Record<string, number> = { top: 0, center: 50, bottom: 100 };
  const tokens = lower.split(/\s+/).filter(Boolean);

  let x: number | null = null;
  let y: number | null = null;

  for (const token of tokens) {
    if (token in mapX && x === null) x = mapX[token];
    if (token in mapY && y === null) y = mapY[token];
  }

  return {
    x: x ?? 50,
    y: y ?? 50,
  };
};

const parsePositionToPercent = (value: string) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return { x: 50, y: 50 };

  const percentMatch = trimmed.match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  if (percentMatch) {
    return {
      x: Math.max(0, Math.min(100, Number(percentMatch[1]))),
      y: Math.max(0, Math.min(100, Number(percentMatch[2]))),
    };
  }

  return parsePositionKeyword(trimmed);
};

const formatPositionFromPercent = (x: number, y: number) => {
  const safeX = Math.max(0, Math.min(100, Math.round(x)));
  const safeY = Math.max(0, Math.min(100, Math.round(y)));
  return `${safeX}% ${safeY}%`;
};

const serializeDocument = (doc: Document) => {
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>\n`
    : '<!DOCTYPE html>\n';
  return `${doctype}${doc.documentElement.outerHTML}`;
};

const updateNodeFromPath = (html: string, path: string, updater: (el: Element, doc: Document) => void): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const target = doc.querySelector(path);
  if (!target) return html;
  updater(target, doc);
  return serializeDocument(doc);
};

const cleanBridgeFromDocument = (doc: Document) => {
  doc.querySelector('#cf-editor-base')?.remove();
  doc.querySelector('#cf-editor-bridge-style')?.remove();
  doc.querySelector('#cf-editor-bridge-script')?.remove();
  doc.querySelectorAll('.cf-editor-hover, .cf-editor-selected').forEach((node) => {
    node.classList.remove('cf-editor-hover', 'cf-editor-selected');
  });
};

const serializeWithoutBridge = (doc: Document) => {
  const cloned = doc.cloneNode(true) as Document;
  cleanBridgeFromDocument(cloned);
  return serializeDocument(cloned);
};

const injectBridgeIntoDocument = (doc: Document) => {
  cleanBridgeFromDocument(doc);

  const style = doc.createElement('style');
  style.id = 'cf-editor-bridge-style';
  style.textContent = BRIDGE_STYLE_CONTENT;
  (doc.head || doc.documentElement).appendChild(style);

  const script = doc.createElement('script');
  script.id = 'cf-editor-bridge-script';
  script.textContent = BRIDGE_SCRIPT_CONTENT;
  (doc.body || doc.documentElement).appendChild(script);
};

export const stripEditorBridge = (html: string): string => {
  if (!html) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  cleanBridgeFromDocument(doc);

  return serializeDocument(doc);
};

export function VisualEditor({
  html,
  onChange,
  saving = false,
  projectId,
  userId,
  projectPublicUrl,
  brandPalette = [],
  layout = 'split',
}: VisualEditorProps) {
  // ...existing code...

  // Embedded code modal state
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [embedCode, setEmbedCode] = useState('');
  const [pendingSectionType, setPendingSectionType] = useState<string | null>(null);

  // Adiciona uma nova sessão predefinida ao final do body, com embed opcional
  const addPredefinedSection = (type: string) => {
    setPendingSectionType(type);
    // Only open embed modal for Embedded type. For other types, insert immediately.
    if (type === 'Embedded') {
      setEmbedCode('');
      setShowEmbedModal(true);
      return;
    }
    // insert immediately for non-embedded predefined sections
    setTimeout(() => confirmAddSectionWithEmbed(), 0);
  };

  // Confirma a adição da sessão com embed
  // HTML templates for each section type (styled as in the generated site)
  const SECTION_HTML_TEMPLATES: Record<string, string> = {
    Hero: `
      <section class="w-full py-20 bg-gradient-to-b from-primary/8 to-background">
        <div class="container mx-auto px-4 text-center">
          <h1 class="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-4" contenteditable="true">Your business, simplified</h1>
          <p class="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-6" contenteditable="true">A concise description that highlights your main value proposition and invites users to learn more.</p>
          <div class="flex items-center justify-center gap-3">
            <a href="#" class="inline-block px-6 py-3 bg-primary text-white rounded-lg font-semibold shadow hover:bg-primary/90 transition">Get Started</a>
            <a href="#" class="inline-block px-4 py-2 bg-card text-foreground rounded-lg font-medium">Learn more</a>
          </div>
        </div>
      </section>
    `,
    Benefits: `
      <section class="w-full py-16 bg-background">
        <div class="container mx-auto px-4">
          <h2 class="text-3xl font-bold mb-8 text-center" contenteditable="true">Why choose us</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="p-6 rounded-lg bg-card shadow">
              <h3 class="text-xl font-semibold mb-2" contenteditable="true">Fast delivery</h3>
              <p class="text-muted-foreground" contenteditable="true">We deliver projects quickly without sacrificing quality.</p>
            </div>
            <div class="p-6 rounded-lg bg-card shadow">
              <h3 class="text-xl font-semibold mb-2" contenteditable="true">Expert team</h3>
              <p class="text-muted-foreground" contenteditable="true">Our experienced team ensures your success.</p>
            </div>
            <div class="p-6 rounded-lg bg-card shadow">
              <h3 class="text-xl font-semibold mb-2" contenteditable="true">Reliable support</h3>
              <p class="text-muted-foreground" contenteditable="true">We’re here to help, whenever you need us.</p>
            </div>
          </div>
        </div>
      </section>
    `,
    'Social Proof': `
      <section class="w-full py-16 bg-muted">
        <div class="container mx-auto px-4">
          <h2 class="text-3xl font-bold mb-8 text-center" contenteditable="true">Trusted by customers</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <blockquote class="p-6 bg-card rounded-lg shadow">
              <p class="mb-2" contenteditable="true">“Amazing service — helped our business grow.”</p>
              <footer class="text-xs text-muted-foreground" contenteditable="true">— Customer Name</footer>
            </blockquote>
            <blockquote class="p-6 bg-card rounded-lg shadow">
              <p class="mb-2" contenteditable="true">“Great communication and fast delivery.”</p>
              <footer class="text-xs text-muted-foreground" contenteditable="true">— Customer Name</footer>
            </blockquote>
            <blockquote class="p-6 bg-card rounded-lg shadow">
              <p class="mb-2" contenteditable="true">“Professional team, highly recommended.”</p>
              <footer class="text-xs text-muted-foreground" contenteditable="true">— Customer Name</footer>
            </blockquote>
          </div>
        </div>
      </section>
    `,
    CTA: `
      <section class="w-full py-16 bg-primary text-white">
        <div class="container mx-auto px-4 text-center">
          <h2 class="text-3xl font-bold mb-4" contenteditable="true">Ready to get started?</h2>
          <a href="#" class="inline-block px-6 py-3 bg-white text-primary rounded-lg font-semibold shadow">Contact us</a>
        </div>
      </section>
    `,
    Form: `
      <section class="w-full py-16 bg-background">
        <div class="container mx-auto px-4 max-w-lg">
          <h2 class="text-3xl font-bold mb-6 text-center" contenteditable="true">Contact us</h2>
          <form class="space-y-4">
            <input type="text" class="w-full px-4 py-2 border rounded" placeholder="Your name" />
            <input type="email" class="w-full px-4 py-2 border rounded" placeholder="Your email" />
            <textarea class="w-full px-4 py-2 border rounded" placeholder="How can we help you?"></textarea>
            <button type="submit" class="w-full px-4 py-2 bg-primary text-white rounded">Send message</button>
          </form>
        </div>
      </section>
    `,
    Download: `
      <section class="w-full py-16 bg-muted">
        <div class="container mx-auto px-4 text-center">
          <h2 class="text-3xl font-bold mb-4" contenteditable="true">Download</h2>
          <p class="mb-4 text-muted-foreground" contenteditable="true">Download resources or files related to this project.</p>
          <a href="#" class="inline-block px-6 py-3 bg-primary text-white rounded-lg font-semibold shadow">Download now</a>
        </div>
      </section>
    `,
    Embedded: `
      <section class="w-full py-16 md:py-24 bg-background">
        <div class="container mx-auto px-4">
          <div class="mx-auto text-center" style="width:50%;max-width:880px;margin-left:auto;margin-right:auto;">
            <h1 class="text-2xl md:text-3xl font-bold mb-2" contenteditable="true">Embedded</h1>
            <p class="text-muted-foreground mb-4" contenteditable="true">Embedded</p>
            <div class="cf-embed-placeholder mx-auto" style="min-height:160px">EMBEDDED APLICADO NA PAGINA</div>
          </div>
        </div>
      </section>
    `,
  };

  const confirmAddSectionWithEmbed = () => {
    if (!pendingSectionType) return;
    applyMutation('body', (el, doc) => {
      let sectionHtml = SECTION_HTML_TEMPLATES[pendingSectionType] || `<section class="cf-section cf-section-${pendingSectionType.toLowerCase().replace(/\s+/g, '-')}"><h2>${pendingSectionType}</h2><p>Section content: ${pendingSectionType}</p></section>`;
      const placeNode = (node: Node) => {
        const footer = doc.querySelector('footer');
        const sectionsContainer = doc.querySelector('#sections');
        if (sectionsContainer) {
          sectionsContainer.appendChild(node);
        } else if (footer && footer.parentNode) {
          footer.parentNode.insertBefore(node, footer);
        } else {
          el.appendChild(node);
        }
      };

      if (pendingSectionType === 'Embedded') {
        // Inserir embed HTML preservando <script> execution e <iframe> rendering
        const raw = embedCode && embedCode.trim() ? embedCode.trim() : '<div>EMBEDDED APLICADO NA PAGINA</div>';
        // use the Embedded template from SECTION_HTML_TEMPLATES so formatting is consistent
        const templateHtml = SECTION_HTML_TEMPLATES['Embedded'] || `<section class="cf-section cf-section-embedded"><h2>Embedded</h2><p>Embedded</p><div class="cf-embed-placeholder"></div></section>`;
        const wrapperForSection = doc.createElement('div');
        wrapperForSection.innerHTML = templateHtml.trim();
        const sectionNode = wrapperForSection.firstElementChild as HTMLElement;
        if (!sectionNode) return;
        placeNode(sectionNode);
        // find the placeholder inside the inserted section specifically
        const placedSection = doc.querySelectorAll('.cf-embed-placeholder');
        let lastPlaced: Element | null = null;
        if (placedSection && placedSection.length) {
          // prefer the placeholder within the section we just placed
          lastPlaced = Array.from(placedSection).reverse().find(p => sectionNode.contains(p));
        }
        const targetParent = lastPlaced || sectionNode;
        // parse raw embed html into nodes and insert, handling scripts specially so they execute
        const parser = doc.createElement('div');
        parser.innerHTML = raw;
        // create an editable wrapper so users can style/size the embed
        const embedWrapper = doc.createElement('div');
        embedWrapper.className = 'cf-embed-container';
        // sensible defaults for editability
        embedWrapper.style.width = '100%';
        embedWrapper.style.minHeight = '200px';
        Array.from(parser.childNodes).forEach((node) => {
          if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'script') {
            const src = (node as HTMLScriptElement).getAttribute('src');
            const newScript = doc.createElement('script');
            Array.from((node as Element).attributes || []).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            if (src) {
              newScript.src = src!;
            } else {
              newScript.textContent = (node as HTMLScriptElement).textContent || '';
            }
            embedWrapper.appendChild(newScript);
          } else if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'iframe') {
            const src = (node as HTMLIFrameElement).getAttribute('src') || '';
            const newIframe = doc.createElement('iframe');
            Array.from((node as Element).attributes || []).forEach(attr => newIframe.setAttribute(attr.name, attr.value));
            if (src) newIframe.src = src;
            embedWrapper.appendChild(newIframe);
          } else {
            const imported = doc.importNode(node, true);
            embedWrapper.appendChild(imported);
          }
        });
        targetParent.appendChild(embedWrapper);
      } else if (embedCode && embedCode.trim()) {
        // Remove o fechamento </section> para inserir embed antes
        sectionHtml = sectionHtml.replace(/<\/section>\s*$/, `${embedCode}\n</section>`);
        const wrapper = doc.createElement('div');
        wrapper.innerHTML = sectionHtml.trim();
        const section = wrapper.firstElementChild as HTMLElement;
        if (section) placeNode(section);
      } else {
        const wrapper = doc.createElement('div');
        wrapper.innerHTML = sectionHtml.trim();
        const section = wrapper.firstElementChild as HTMLElement;
        if (section) placeNode(section);
      }
    });
    setShowEmbedModal(false);
    setEmbedCode('');
    setPendingSectionType(null);
  };

  // Move uma sessão para cima/baixo
  const moveSection = (sectionPath: string, direction: 'up' | 'down') => {
    applyMutation(sectionPath, (el) => {
      if (direction === 'up') {
        const prev = el.previousElementSibling;
        if (prev) prev.before(el);
      } else {
        const next = el.nextElementSibling;
        if (next) next.after(el);
      }
    });
  };
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratingError, setAiGeneratingError] = useState('');
  const [aiGeneratedImages, setAiGeneratedImages] = useState<Array<{
    id: number;
    prompt: string;
    imageUrl: string;
    provider?: string;
    model?: string;
    reason?: string;
    fallback?: boolean;
  }>>([]);
  const [addingGeneratedImageId, setAddingGeneratedImageId] = useState<number | null>(null);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const selectedRef = useRef<SelectedNode | null>(null);
  const [textValue, setTextValue] = useState('');
  const [hrefValue, setHrefValue] = useState('');
  const [linkTarget, setLinkTarget] = useState('_self');
  const [linkRel, setLinkRel] = useState('');
  const [fileDownloadPath, setFileDownloadPath] = useState('');
  const [srcValue, setSrcValue] = useState('');
  const [selectedBackground, setSelectedBackground] = useState(false);
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(null);
  const [imageFit, setImageFit] = useState('cover');
  const [imagePosition, setImagePosition] = useState('center');
  const [imagePositionX, setImagePositionX] = useState(50);
  const [imagePositionY, setImagePositionY] = useState(50);
  const [imageWidth, setImageWidth] = useState('');
  const [imageMinWidth, setImageMinWidth] = useState('');
  const [imageHeight, setImageHeight] = useState('');
  const [imageMinHeight, setImageMinHeight] = useState('');
  const [imageMaxWidth, setImageMaxWidth] = useState('');
  const [imageMaxHeight, setImageMaxHeight] = useState('');
  const [imageAspectRatio, setImageAspectRatio] = useState('');
  const [containerWidth, setContainerWidth] = useState('');
  const [containerMinWidth, setContainerMinWidth] = useState('');
  const [containerHeight, setContainerHeight] = useState('');
  const [containerMinHeight, setContainerMinHeight] = useState('');
  const [containerMaxWidth, setContainerMaxWidth] = useState('');
  const [containerMaxHeight, setContainerMaxHeight] = useState('');
  const [selectedWrapperPath, setSelectedWrapperPath] = useState<string | null>(null);
  const [containerPaddingTop, setContainerPaddingTop] = useState('');
  const [containerPaddingBottom, setContainerPaddingBottom] = useState('');
  const [containerPaddingLeft, setContainerPaddingLeft] = useState('');
  const [containerPaddingRight, setContainerPaddingRight] = useState('');
  const [containerMarginTop, setContainerMarginTop] = useState('');
  const [containerMarginBottom, setContainerMarginBottom] = useState('');
  const [containerMarginLeft, setContainerMarginLeft] = useState('');
  const [containerMarginRight, setContainerMarginRight] = useState('');
  const [containerBorderWidth, setContainerBorderWidth] = useState('');
  const [containerBorderColor, setContainerBorderColor] = useState('#000000');
  const [containerBorderRadius, setContainerBorderRadius] = useState('');
  const [containerAlignItems, setContainerAlignItems] = useState<string>('');
  const [containerJustifyContent, setContainerJustifyContent] = useState<string>('');
  const [containerDisplay, setContainerDisplay] = useState<string>('');
  const [containerFlexDirection, setContainerFlexDirection] = useState<string>('');
  const [containerFlexWrap, setContainerFlexWrap] = useState<string>('');
  const [containerGap, setContainerGap] = useState<string>('');
  const [containerGridTemplateColumns, setContainerGridTemplateColumns] = useState<string>('');
  const [containerGridGap, setContainerGridGap] = useState<string>('');
  const [containerGridAutoFlow, setContainerGridAutoFlow] = useState<string>('');

  // --- simple validators for CSS-like inputs ---
  const sizeRegex = /^-?\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh|ch|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|fr)?$/i;
  const cssUnits = ['px', 'rem', 'em', '%', 'vw', 'vh', 'ch', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', 'fr'];
  const isCssSize = (v: string) => {
    if (!v) return true;
    const s = v.trim();
    if (!s) return false;
    const keywords = ['auto', 'none', 'initial', 'inherit', 'unset', 'normal', 'fit-content', 'min-content', 'max-content', 'content'];
    if (keywords.includes(s)) return true;
    if (sizeRegex.test(s)) return true;
    if (/^(calc|min|max|clamp|var)\(.+\)$/.test(s)) return true;
    return false;
  };

  const isGap = (v: string) => isCssSize(v);

  const isGridTemplate = (v: string) => {
    if (!v) return true;
    const s = v.trim();
    // allow common functions and fr units
    if (/^repeat\(/i.test(s)) return true;
    if (/minmax\(/i.test(s)) return true;
    if (s.includes('fr')) return true;
    // allow space-separated sizes like "200px 1fr"
    return s.split(/\s+/).every(part => isCssSize(part) || /fr$/i.test(part));
  };

  // extract unit from previous value, fallback to 'px'
  const extractUnit = (prev: string) => {
    if (!prev) return 'px';
    const m = prev.trim().toLowerCase().match(/[a-z%]+$/i);
    if (!m) return 'px';
    const unit = m[0];
    return cssUnits.includes(unit) ? unit : 'px';
  };

  const normalizeSizeWithFallback = (val: string, prev: string) => {
    if (!val) return '';
    const s = val.trim();
    if (!s) return '';
    // allow functions and keywords
    if (/^(calc\(|repeat\(|minmax\(|clamp\(|min\(|max\(|var\(|auto$|none$|initial$|inherit$|unset$|normal$|fit-content$|min-content$|max-content$|content$)/i.test(s)) return s;
    // if already has unit or contains non-numeric chars, return as-is
    if (sizeRegex.test(s)) return s;
    // if it's a plain number, append previous unit
    const numOnly = s.match(/^-?\d+(?:\.\d+)?$/);
    if (numOnly) {
      const unit = extractUnit(prev);
      return `${s}${unit}`;
    }
    return s;
  };

  // error flags for inputs
  const [cwError, setCwError] = useState(false);
  const [cmwError, setCmwError] = useState(false);
  const [chError, setChError] = useState(false);
  const [cmhError, setCmhError] = useState(false);
  const [cmaxwError, setCmaxwError] = useState(false);
  const [cmaxhError, setCmaxhError] = useState(false);
  const [cpadTError, setCpadTError] = useState(false);
  const [cpadBError, setCpadBError] = useState(false);
  const [cpadLError, setCpadLError] = useState(false);
  const [cpadRError, setCpadRError] = useState(false);
  const [cmTError, setCmTError] = useState(false);
  const [cmBError, setCmBError] = useState(false);
  const [cmLError, setCmLError] = useState(false);
  const [cmRError, setCmRError] = useState(false);
  const [cbwError, setCbwError] = useState(false);
  const [cbrError, setCbrError] = useState(false);
  const [cgapError, setCgapError] = useState(false);
  const [cgridColsError, setCgridColsError] = useState(false);
  const [cgridGapError, setCgridGapError] = useState(false);
  const lastEditorMarkerRef = useRef<string | null>(null);
  const [textColor, setTextColor] = useState('#111111');
  const [textOpacity, setTextOpacity] = useState(100);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [paddingTop, setPaddingTop] = useState(16);
  const [paddingBottom, setPaddingBottom] = useState(16);
  const [paddingLeft, setPaddingLeft] = useState(0);
  const [paddingRight, setPaddingRight] = useState(0);
  const [marginTop, setMarginTop] = useState(0);
  const [marginBottom, setMarginBottom] = useState(0);
  const [marginLeft, setMarginLeft] = useState(0);
  const [marginRight, setMarginRight] = useState(0);
  const [fontFamily, setFontFamily] = useState('');
  const [fontFamilyPickerValue, setFontFamilyPickerValue] = useState('__custom__');
  const [customFontFamilyDraft, setCustomFontFamilyDraft] = useState('');
  const [fontSize, setFontSize] = useState(16);
  const [fontWeight, setFontWeight] = useState(400);
  const [borderRadius, setBorderRadius] = useState(0);
  const [textAlign, setTextAlign] = useState('left');
  const [lineHeight, setLineHeight] = useState('');
  const [whiteSpaceMode, setWhiteSpaceMode] = useState('normal');
  const [overflowWrapMode, setOverflowWrapMode] = useState('normal');
  const [wordBreakMode, setWordBreakMode] = useState('normal');
  const [textWrapMode, setTextWrapMode] = useState('wrap');
  const [bgOpacity, setBgOpacity] = useState(100);
  const [sectionBgMode, setSectionBgMode] = useState<'solid' | 'gradient' | 'image'>('solid');
  const [bgImageUrl, setBgImageUrl] = useState('');
  const [bgImageSize, setBgImageSize] = useState('cover');
  const [bgImagePosition, setBgImagePosition] = useState('center');
  const [bgImagePositionX, setBgImagePositionX] = useState(50);
  const [bgImagePositionY, setBgImagePositionY] = useState(50);
  const [bgImageRepeat, setBgImageRepeat] = useState('no-repeat');
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('none');
  const [overlayColor, setOverlayColor] = useState('#000000');
  const [overlayOpacity, setOverlayOpacity] = useState(35);
  const [overlayGrad1, setOverlayGrad1] = useState('#000000');
  const [overlayGrad2, setOverlayGrad2] = useState('#ffffff');
  const [overlayAngle, setOverlayAngle] = useState(180);
  const [darkOverlayStrength, setDarkOverlayStrength] = useState(45);
  const [gradientColor1, setGradientColor1] = useState('#ffffff');
  const [gradientColor2, setGradientColor2] = useState('#e2e8f0');
  const [gradientAngle, setGradientAngle] = useState(135);
  const [showAssetManager, setShowAssetManager] = useState(false);
  const [showBgAssetManager, setShowBgAssetManager] = useState(false);
  const [assetUrlInput, setAssetUrlInput] = useState('');
  const [bgAssetUrlInput, setBgAssetUrlInput] = useState('');
  const [assetUrlImporting, setAssetUrlImporting] = useState(false);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetsPublicUrl, setAssetsPublicUrl] = useState('');
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsUploading, setAssetsUploading] = useState(false);
  const [showFilesFolder, setShowFilesFolder] = useState(false);
  const [files, setFiles] = useState<ProjectAsset[]>([]);
  const [filesPublicUrl, setFilesPublicUrl] = useState('');
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesUploading, setFilesUploading] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [editorTab, setEditorTab] = useState<'element' | 'sections'>('element');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [snapshots, setSnapshots] = useState<EditorSnapshot[]>([]);
  const [, setHistoryVersion] = useState(0);
  const nextGeneratedImageIdRef = useRef(1);
  const nextSnapshotIdRef = useRef(1);
  const historyPastRef = useRef<string[]>([]);
  const historyFutureRef = useRef<string[]>([]);
  const lastHtmlRef = useRef('');
  const skipHistoryRecordRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileFolderInputRef = useRef<HTMLInputElement | null>(null);
  const filesPanelRef = useRef<HTMLDivElement | null>(null);
  const emitChangeFrameRef = useRef<number | null>(null);
  const pendingChangeRef = useRef<string | null>(null);
  const lastEmittedHtmlRef = useRef('');

  const canUndo = historyPastRef.current.length > 0;
  const canRedo = historyFutureRef.current.length > 0;

  const snapshotsStorageKey = useMemo(() => {
    if (!projectId || !userId) return '';
    return `chiliforge-editor-snapshots:${userId}:${projectId}`;
  }, [projectId, userId]);

  const livePreviewUrl = useMemo(() => {
    const base = (projectPublicUrl || '').trim();
    if (!base) return '';
    const normalized = base.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
    const sep = normalized.includes('?') ? '&' : '?';
    return `${normalized}${sep}cf_editor_ts=${Date.now()}`;
  }, [projectPublicUrl]);

  // Batch high-frequency mutations into animation frames to keep long editing sessions smooth.
  const emitChange = useCallback((next: string) => {
    pendingChangeRef.current = stripEditorBridge(next);

    if (emitChangeFrameRef.current !== null) return;

    emitChangeFrameRef.current = window.requestAnimationFrame(() => {
      emitChangeFrameRef.current = null;
      const payload = pendingChangeRef.current;
      pendingChangeRef.current = null;
      if (typeof payload !== 'string') return;
      if (payload === lastEmittedHtmlRef.current) return;
      lastEmittedHtmlRef.current = payload;
      onChange(payload);
    });
  }, [onChange]);

  useEffect(() => () => {
    if (emitChangeFrameRef.current !== null) {
      window.cancelAnimationFrame(emitChangeFrameRef.current);
    }
  }, []);

  const handleIframeLoad = useCallback(() => {
    setIframeReady(true);

    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) throw new Error('Live document is not accessible.');

      injectBridgeIntoDocument(doc);

      const docWithHandler = doc as Document & { __cfParentSelectionHandler?: EventListener };
      if (docWithHandler.__cfParentSelectionHandler) {
        doc.removeEventListener('click', docWithHandler.__cfParentSelectionHandler, true);
      }

      const buildCssPath = (el: Element | null) => {
        if (!el || el === doc.documentElement) return 'html';
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && node !== doc.body) {
          const tag = node.tagName.toLowerCase();
          let idx = 1;
          let sibling = node.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === node.tagName) idx += 1;
            sibling = sibling.previousElementSibling;
          }
          parts.unshift(`${tag}:nth-of-type(${idx})`);
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };

      const parentSelectionHandler: EventListener = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const frameWindow = doc.defaultView;
        if (!frameWindow) return;

        const computed = frameWindow.getComputedStyle(target);
        const payload: SelectedNode = {
          path: buildCssPath(target),
          sectionPath: target.closest('section') ? buildCssPath(target.closest('section')) : null,
          tag: target.tagName.toLowerCase(),
          text: (target.textContent || '').trim().slice(0, 500),
          fontFamily: computed.fontFamily || '',
          lineHeight: computed.lineHeight || '',
          whiteSpace: computed.whiteSpace || '',
          overflowWrap: computed.overflowWrap || '',
          wordBreak: computed.wordBreak || '',
          textWrap: computed.textWrap || '',
          src: target.getAttribute('src') || '',
          objectFit: computed.objectFit || 'fill',
          objectPosition: computed.objectPosition || '50% 50%',
          width: computed.width || '',
          minWidth: computed.minWidth || '',
          height: computed.height || '',
          minHeight: computed.minHeight || '',
          maxWidth: computed.maxWidth || '',
          maxHeight: computed.maxHeight || '',
          aspectRatio: computed.aspectRatio || '',
          href: target.getAttribute('href') || '',
          target: target.getAttribute('target') || '',
          rel: target.getAttribute('rel') || '',
          color: computed.color || '',
          backgroundColor: computed.backgroundColor || '',
          backgroundImage: computed.backgroundImage || '',
          backgroundSize: computed.backgroundSize || '',
          backgroundPosition: computed.backgroundPosition || '',
          backgroundRepeat: computed.backgroundRepeat || '',
          paddingTop: computed.paddingTop || '0px',
          paddingBottom: computed.paddingBottom || '0px',
          marginTop: computed.marginTop || '0px',
          marginBottom: computed.marginBottom || '0px',
          fontSize: computed.fontSize || '16px',
          fontWeight: computed.fontWeight || '400',
          textAlign: computed.textAlign || 'left',
          borderRadius: computed.borderRadius || '0px',
          isButtonLike: target.tagName === 'BUTTON' || target.tagName === 'A',
        };

        window.postMessage({ source: EDITOR_MESSAGE_SOURCE, type: 'select', payload }, '*');
      };

      doc.addEventListener('click', parentSelectionHandler, true);
      docWithHandler.__cfParentSelectionHandler = parentSelectionHandler;

      const serialized = serializeWithoutBridge(doc);
      if (serialized && stripEditorBridge(serialized).trim() !== stripEditorBridge(html).trim()) {
        emitChange(serialized);
      }
    } catch {
      toast.error('Live mode could not access the page DOM.');
    }
  }, [html, emitChange]);

  useEffect(() => { setIframeReady(false); }, [livePreviewUrl]);

  useEffect(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    lastHtmlRef.current = stripEditorBridge(html || '');
    lastEmittedHtmlRef.current = stripEditorBridge(html || '');
    skipHistoryRecordRef.current = false;
    setSelected(null);
    setHistoryVersion((value) => value + 1);
  }, [projectId, userId]);

  useEffect(() => {
    setSnapshots([]);

    if (!snapshotsStorageKey) {
      nextSnapshotIdRef.current = 1;
      return;
    }

    try {
      const parsed = safeGetJSON(snapshotsStorageKey) as unknown;
      if (!parsed || !Array.isArray(parsed)) {
        nextSnapshotIdRef.current = 1;
        return;
      }

      const sanitized = parsed
        .filter((item): item is EditorSnapshot => {
          if (!item || typeof item !== 'object') return false;
          const maybe = item as Partial<EditorSnapshot>;
          return typeof maybe.id === 'number'
            && typeof maybe.label === 'string'
            && typeof maybe.html === 'string'
            && typeof maybe.createdAt === 'number';
        })
        .slice(0, SNAPSHOT_LIMIT);

      setSnapshots(sanitized);
      const maxId = sanitized.reduce((acc, item) => Math.max(acc, item.id), 0);
      nextSnapshotIdRef.current = maxId + 1;
    } catch {
      nextSnapshotIdRef.current = 1;
      setSnapshots([]);
    }
  }, [snapshotsStorageKey]);

  useEffect(() => {
    if (!snapshotsStorageKey) return;

    try {
      safeSetJSON(snapshotsStorageKey, snapshots.slice(0, SNAPSHOT_LIMIT));
    } catch {
      // Ignore storage errors — safeSetJSON handles trimming/clearing.
    }
  }, [snapshots, snapshotsStorageKey]);


  useEffect(() => {
    if (skipHistoryRecordRef.current) {
      lastHtmlRef.current = html;
      skipHistoryRecordRef.current = false;
      return;
    }

    if (!lastHtmlRef.current) {
      lastHtmlRef.current = html;
      return;
    }

    if (html !== lastHtmlRef.current) {
      historyPastRef.current.push(lastHtmlRef.current);
      if (historyPastRef.current.length > HISTORY_LIMIT) {
        historyPastRef.current = historyPastRef.current.slice(-HISTORY_LIMIT);
      }
      historyFutureRef.current = [];
      lastHtmlRef.current = html;
      setHistoryVersion((value) => value + 1);

      // Salvar snapshot automático
      const cleanHtml = stripEditorBridge(html);
      const now = new Date();
      const label = `Snapshot ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      setSnapshots((prev) => {
        // Evita snapshot duplicado se o último já for igual
        if (prev[0] && prev[0].html.trim() === cleanHtml.trim()) return prev;
        const next = [
          {
            id: nextSnapshotIdRef.current,
            label,
            html: cleanHtml,
            createdAt: Date.now(),
          },
          ...prev,
        ].slice(0, SNAPSHOT_LIMIT);
        nextSnapshotIdRef.current += 1;
        return next;
      });
    }
  }, [html]);

  const undo = useCallback(() => {
    const previous = historyPastRef.current.pop();
    if (!previous) return;

    historyFutureRef.current.push(stripEditorBridge(lastHtmlRef.current || html));
    skipHistoryRecordRef.current = true;
    lastHtmlRef.current = previous;
    setSelected(null);
    // Força atualização do iframe e do editor
    emitChange(previous);
    setHistoryVersion((value) => value + 1);
    // Se o iframe estiver pronto, atualiza o DOM dele também
    setTimeout(() => {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previous);
        doc.close();
        injectBridgeIntoDocument(doc);
      }
    }, 0);
  }, [html, emitChange]);

  const redo = useCallback(() => {
    const next = historyFutureRef.current.pop();
    if (!next) return;

    historyPastRef.current.push(stripEditorBridge(lastHtmlRef.current || html));
    if (historyPastRef.current.length > HISTORY_LIMIT) {
      historyPastRef.current = historyPastRef.current.slice(-HISTORY_LIMIT);
    }

    skipHistoryRecordRef.current = true;
    lastHtmlRef.current = next;
    setSelected(null);
    emitChange(next);
    setHistoryVersion((value) => value + 1);
    // Força atualização do iframe e do editor
    setTimeout(() => {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        doc.open();
        doc.write(next);
        doc.close();
        injectBridgeIntoDocument(doc);
      }
    }, 0);
  }, [html, emitChange]);

  const saveSnapshot = useCallback(() => {
    const cleanHtml = stripEditorBridge(html);
    const now = new Date();
    const label = `Snapshot ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    setSnapshots((prev) => {
      const next: EditorSnapshot[] = [
        {
          id: nextSnapshotIdRef.current,
          label,
          html: cleanHtml,
          createdAt: Date.now(),
        },
        ...prev,
      ].slice(0, SNAPSHOT_LIMIT);

      nextSnapshotIdRef.current += 1;
      return next;
    });

    toast.success('Snapshot saved.');
  }, [html]);

  const restoreSnapshot = useCallback((snapshot: EditorSnapshot) => {
    const cleanCurrent = stripEditorBridge(html);
    if (cleanCurrent.trim() === snapshot.html.trim()) {
      toast.message('Snapshot already matches current version.');
      return;
    }

    skipHistoryRecordRef.current = false;
    setSelected(null);
    onChange(snapshot.html);
    toast.success(`Restored: ${snapshot.label}`);
  }, [html, onChange]);

  const deleteSnapshot = useCallback((snapshotId: number) => {
    setSnapshots((prev) => prev.filter((item) => item.id !== snapshotId));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        const isTypingField = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
        if (isTypingField) return;
      }

      const withModifier = event.ctrlKey || event.metaKey;
      if (!withModifier || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const applyMutation = useCallback((path: string, updater: (el: Element, doc: Document) => void) => {
    if (!path) return;

    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      toast.error('Live page is not ready yet.');
      return;
    }

    const target = doc.querySelector(path);
    if (!target) {
      toast.error('Selected element was not found in live page.');
      return;
    }

    updater(target, doc);
    injectBridgeIntoDocument(doc);
    emitChange(serializeWithoutBridge(doc));
  }, [emitChange]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== EDITOR_MESSAGE_SOURCE || data.type !== 'select') return;
      const payload = data.payload as SelectedNode;
      setSelected(payload);
      setTextValue(payload.text || '');
      setHrefValue(payload.href || '');
      setLinkTarget(payload.target || '_self');
      setLinkRel(payload.rel || '');
      setSrcValue(payload.src || '');
      // detect background-image url(...) and surface it as selected image
      const bgMatch = (payload.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/i);
      const bgUrl = bgMatch ? bgMatch[1] : '';
      if (bgUrl) {
        setSrcValue(bgUrl);
        setSelectedBackground(true);
        setSelectedImagePath(payload.sectionPath || null);
      } else {
        setSelectedBackground(false);
        setSelectedImagePath(null);
      }

      // mark the exact clicked element with a unique data attribute so edits target it alone
      try {
        const doc = iframeRef.current?.contentDocument;
        if (doc) {
          const clickedEl = doc.querySelector(payload.path);
          if (clickedEl) {
            try {
              if (lastEditorMarkerRef.current) {
                const prevEl = doc.querySelector(`[data-cf-editor-id="${lastEditorMarkerRef.current}"]`);
                if (prevEl) prevEl.removeAttribute('data-cf-editor-id');
              }
            } catch (e) {}
            const marker = `cfsel-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
            try { clickedEl.setAttribute('data-cf-editor-id', marker); } catch (e) {}
            try {
              // if selected element is an anchor, read its download attribute
              if ((clickedEl as HTMLElement).tagName && (clickedEl as HTMLElement).tagName.toLowerCase() === 'a') {
                const a = clickedEl as HTMLAnchorElement;
                const dl = a.getAttribute('download') || '';
                setFileDownloadPath(dl);
              } else {
                setFileDownloadPath('');
              }
            } catch (e) {}
            lastEditorMarkerRef.current = marker;
            const markerSelector = `[data-cf-editor-id="${marker}"]`;
            setSelectedWrapperPath(null);
            setSelected(prev => prev ? ({ ...prev, path: markerSelector }) : prev);

            // Keep Container / Div controls in sync with the clicked element styles.
            try {
              const cs = window.getComputedStyle(clickedEl as Element);
              setContainerWidth(cs.width || '');
              setContainerMinWidth(cs.minWidth || '');
              setContainerHeight(cs.height || '');
              setContainerMinHeight(cs.minHeight || '');
              setContainerMaxWidth(cs.maxWidth || '');
              setContainerMaxHeight(cs.maxHeight || '');
              setContainerPaddingTop(cs.paddingTop || '');
              setContainerPaddingBottom(cs.paddingBottom || '');
              setContainerPaddingLeft(cs.paddingLeft || '');
              setContainerPaddingRight(cs.paddingRight || '');
              setContainerMarginTop(cs.marginTop || '');
              setContainerMarginBottom(cs.marginBottom || '');
              setContainerMarginLeft(cs.marginLeft || '');
              setContainerMarginRight(cs.marginRight || '');
              setContainerBorderWidth(cs.borderWidth || '');
              setContainerBorderRadius(cs.borderRadius || '');
              try { setContainerBorderColor(rgbToHex(cs.borderColor || '#000000')); } catch (e) {}
              setContainerDisplay(cs.display || '');
              setContainerFlexDirection(cs.flexDirection || '');
              setContainerFlexWrap(cs.flexWrap || '');
              setContainerGap(cs.gap || '');
              setContainerGridTemplateColumns(cs.gridTemplateColumns || '');
              setContainerGridGap(cs.gridGap || cs.gap || '');
              setContainerGridAutoFlow(cs.gridAutoFlow || '');
            } catch (e) {
              // ignore
            }
          }
        }
      } catch (e) {
        // ignore
      }

      // If user clicked a non-image node inside a section, try finding an image or background inside the section
      try {
        const doc = iframeRef.current?.contentDocument;
        if (!bgUrl && payload.tag !== 'img' && doc && payload.sectionPath) {
          const sectionEl = doc.querySelector(payload.sectionPath);
          if (sectionEl) {
            // prefer a real <img> inside the section
            const img = sectionEl.querySelector('img');
            if (img && img.getAttribute('src')) {
              // compute css path for this img
              const computeCssPath = (el: Element | null) => {
                if (!el || el === doc.documentElement) return 'html';
                const parts: string[] = [];
                let node: Element | null = el as Element;
                while (node && node.nodeType === 1 && node !== doc.body) {
                  const tag = node.tagName.toLowerCase();
                  let idx = 1;
                  let sib = node.previousElementSibling as Element | null;
                  while (sib) {
                    if (sib.tagName === node.tagName) idx++;
                    sib = sib.previousElementSibling as Element | null;
                  }
                  parts.unshift(`${tag}:nth-of-type(${idx})`);
                  node = node.parentElement;
                }
                return `body > ${parts.join(' > ')}`;
              };
              const imgPath = computeCssPath(img);
              setSelectedImagePath(imgPath);
              setSrcValue(img.getAttribute('src') || '');
              setSelectedBackground(false);
            } else {
              // look for background-image on the section itself
              const cs = window.getComputedStyle(sectionEl as Element);
              const sectionBg = cs.backgroundImage || '';
              const m = sectionBg.match(/url\(["']?(.*?)["']?\)/i);
              if (m) {
                setSelectedImagePath(payload.sectionPath || null);
                setSrcValue(m[1]);
                setSelectedBackground(true);
              }
            }
          }
        }
        // prefer selecting an explicit embed wrapper if click occurred inside an embed
        try {
          const doc2 = iframeRef.current?.contentDocument;
          if (doc2) {
            const clickedEl = doc2.querySelector(payload.path);
            if (clickedEl) {
              let node: Element | null = clickedEl;
              while (node && node !== doc2.body) {
                if (node.classList && (node.classList.contains('cf-embed-container') || node.classList.contains('cf-embed-placeholder') || node.classList.contains('cf-section-embedded'))) {
                  // compute css path for wrapper
                  const computeCssPathWrapper = (el: Element | null) => {
                    if (!el || el === doc2.documentElement) return 'html';
                    const parts: string[] = [];
                    let n: Element | null = el as Element;
                    while (n && n.nodeType === 1 && n !== doc2.body) {
                      const tag = n.tagName.toLowerCase();
                      let idx = 1;
                      let sib = n.previousElementSibling as Element | null;
                      while (sib) { if (sib.tagName === n.tagName) idx++; sib = sib.previousElementSibling as Element | null; }
                      parts.unshift(`${tag}:nth-of-type(${idx})`);
                      n = n.parentElement;
                    }
                    return `body > ${parts.join(' > ')}`;
                  };
                  const wrapperPath = computeCssPathWrapper(node);
                  // mark element with unique data attribute to ensure uniqueness across similar structures
                  try {
                    const doc3 = iframeRef.current?.contentDocument;
                    if (doc3) {
                      // remove previous marker
                      if (lastEditorMarkerRef.current) {
                        const prevEl = doc3.querySelector(`[data-cf-editor-id="${lastEditorMarkerRef.current}"]`);
                        if (prevEl) prevEl.removeAttribute('data-cf-editor-id');
                      }
                      const marker = `cfsel-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                      const targetNode = node as Element;
                      targetNode.setAttribute('data-cf-editor-id', marker);
                      lastEditorMarkerRef.current = marker;
                      const markerSelector = `[data-cf-editor-id="${marker}"]`;
                      setSelectedWrapperPath(markerSelector);
                      setSelected(prev => prev ? ({ ...prev, path: markerSelector, tag: 'div' }) : prev);
                    } else {
                      setSelectedWrapperPath(wrapperPath);
                      setSelected(prev => prev ? ({ ...prev, path: wrapperPath, tag: 'div' }) : prev);
                    }
                  } catch (e) {
                    setSelectedWrapperPath(wrapperPath);
                    setSelected(prev => prev ? ({ ...prev, path: wrapperPath, tag: 'div' }) : prev);
                  }
                  // populate container sizing from wrapper computed style
                  try {
                    const cs = window.getComputedStyle(node as Element);
                    setContainerWidth(cs.width || '');
                    setContainerMinWidth(cs.minWidth || '');
                    setContainerHeight(cs.height || '');
                    setContainerMinHeight(cs.minHeight || '');
                    setContainerMaxWidth(cs.maxWidth || '');
                    setContainerMaxHeight(cs.maxHeight || '');
                    setContainerPaddingTop(cs.paddingTop || '');
                    setContainerPaddingBottom(cs.paddingBottom || '');
                    setContainerPaddingLeft(cs.paddingLeft || '');
                    setContainerPaddingRight(cs.paddingRight || '');
                    setContainerMarginTop(cs.marginTop || '');
                    setContainerMarginBottom(cs.marginBottom || '');
                    setContainerMarginLeft(cs.marginLeft || '');
                    setContainerMarginRight(cs.marginRight || '');
                    setContainerBorderWidth(cs.borderWidth || '');
                    setContainerBorderRadius(cs.borderRadius || '');
                    // try color
                    try { setContainerBorderColor(rgbToHex(cs.borderColor || '#000000')); } catch(e) {}
                      // populate layout-related computed styles
                      try {
                        setContainerDisplay(cs.display || '');
                        setContainerFlexDirection(cs.flexDirection || '');
                        setContainerFlexWrap(cs.flexWrap || '');
                        // gap works for flex and grid; prefer explicit gap
                        setContainerGap(cs.gap || '');
                        setContainerGridTemplateColumns(cs.gridTemplateColumns || '');
                        // grid gap / grid-row-gap fallbacks
                        const gridGap = cs.gridGap || cs.gap || '';
                        setContainerGridGap(gridGap);
                        setContainerGridAutoFlow(cs.gridAutoFlow || '');
                      } catch (e) {
                        // ignore
                      }
                  } catch (e) {
                    // ignore
                  }
                  break;
                }
                node = node.parentElement;
              }
            }
          }
        } catch (e) {
          // ignore
        }
      } catch (e) {
        // ignore cross-origin or other errors
      }
      setImageFit(payload.objectFit || 'cover');
      const nextImagePosition = payload.objectPosition && payload.objectPosition !== 'initial' ? payload.objectPosition : 'center';
      setImagePosition(nextImagePosition);
      const parsedImagePos = parsePositionToPercent(nextImagePosition);
      setImagePositionX(parsedImagePos.x);
      setImagePositionY(parsedImagePos.y);
      setImageWidth(payload.width || '');
      setImageMinWidth(payload.minWidth || '');
      setImageHeight(payload.height || '');
      setImageMinHeight(payload.minHeight || '');
      setImageMaxWidth(payload.maxWidth || '');
      setImageMaxHeight(payload.maxHeight || '');
      setImageAspectRatio(payload.aspectRatio || '');
      const parsedText = parseColorWithAlpha(payload.color || '#111111');
      setTextColor(parsedText.hex || rgbToHex(payload.color || '#111111'));
      setTextOpacity(parsedText.alpha);
      const parsedBg = parseColorWithAlpha(payload.backgroundColor || '#ffffff');
      setBgColor(parsedBg.hex);
      setBgOpacity(parsedBg.alpha);
      setGradientColor1(parsedBg.hex);
      const gradient = parseLinearGradient(payload.backgroundImage || '');
      if (gradient) {
        setSectionBgMode('gradient');
        setBgImageUrl('');
        setGradientColor1(gradient.c1.hex);
        setGradientColor2(gradient.c2.hex);
        setGradientAngle(gradient.angle);
        setBgOpacity(Math.round((gradient.c1.alpha + gradient.c2.alpha) / 2));
      } else if (bgUrl) {
        setSectionBgMode('image');
        setBgImageUrl(bgUrl);
      } else {
        setSectionBgMode('solid');
        setBgImageUrl('');
      }
      setBgImageSize(payload.backgroundSize || 'cover');
      const nextBgPosition = payload.backgroundPosition || 'center';
      setBgImagePosition(nextBgPosition);
      const parsedBgPos = parsePositionToPercent(nextBgPosition);
      setBgImagePositionX(parsedBgPos.x);
      setBgImagePositionY(parsedBgPos.y);
      setBgImageRepeat(payload.backgroundRepeat || 'no-repeat');
      setOverlayMode('none');
      setOverlayColor('#000000');
      setOverlayOpacity(35);
      setOverlayGrad1('#000000');
      setOverlayGrad2('#ffffff');
      setOverlayAngle(180);
      setDarkOverlayStrength(45);
      const docForSection = iframeRef.current?.contentDocument;
      const sectionEl = payload.sectionPath ? docForSection?.querySelector(payload.sectionPath) : null;
      const sectionStyles = sectionEl ? window.getComputedStyle(sectionEl as Element) : null;
      setPaddingTop(toPxNumber(sectionStyles?.paddingTop || payload.paddingTop, 16));
      setPaddingBottom(toPxNumber(sectionStyles?.paddingBottom || payload.paddingBottom, 16));
      setPaddingLeft(toPxNumber(sectionStyles?.paddingLeft || '', 0));
      setPaddingRight(toPxNumber(sectionStyles?.paddingRight || '', 0));
      setMarginTop(toPxNumber(sectionStyles?.marginTop || payload.marginTop, 0));
      setMarginBottom(toPxNumber(sectionStyles?.marginBottom || payload.marginBottom, 0));
      setMarginLeft(toPxNumber(sectionStyles?.marginLeft || '', 0));
      setMarginRight(toPxNumber(sectionStyles?.marginRight || '', 0));
      setFontFamily(payload.fontFamily || '');
      setFontSize(toPxNumber(payload.fontSize, 16));
      setFontWeight(Number.parseInt(payload.fontWeight || '400', 10) || 400);
      setTextAlign(payload.textAlign || 'left');
      setLineHeight(payload.lineHeight || '');
      setWhiteSpaceMode(payload.whiteSpace || 'normal');
      setOverflowWrapMode(payload.overflowWrap || 'normal');
      setWordBreakMode(payload.wordBreak || 'normal');
      setTextWrapMode(payload.textWrap || 'wrap');
      setBorderRadius(toPxNumber(payload.borderRadius, 0));
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const applyTextLive = (nextText: string) => {
    if (!selected?.path) return;
    applyMutation(selected.path, (el) => {
      if (el.children.length === 0) {
        el.textContent = nextText;
      } else {
        const firstTextNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
        if (firstTextNode) {
          firstTextNode.textContent = nextText;
        } else {
          el.prepend(el.ownerDocument.createTextNode(nextText));
        }
      }
    });
  };

  const applyImageLive = (nextSrc: string) => {
    const targetPath = selectedImagePath || selected?.path;
    if (!targetPath) return;
    // try to apply to img if the target is an img
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const targetEl = doc.querySelector(targetPath);
      if (!targetEl) return;
      if (targetEl.tagName.toLowerCase() === 'img') {
        applyMutation(targetPath, (el) => {
          el.setAttribute('src', nextSrc);
          if (!el.getAttribute('alt')) el.setAttribute('alt', 'Updated image');
        });
        return;
      }
      // otherwise apply as background-image
      applyMutation(targetPath, (el) => {
        (el as HTMLElement).style.backgroundImage = `url('${nextSrc}')`;
      });
    } catch (e) {
      // ignore
    }
  };

  const applyImageFormattingLive = (overrides?: Partial<{
    nextFit: string;
    nextPosition: string;
    nextWidth: string;
    nextMinWidth: string;
    nextHeight: string;
    nextMinHeight: string;
    nextMaxWidth: string;
    nextMaxHeight: string;
    nextAspectRatio: string;
    nextOverlayMode: OverlayMode;
    nextOverlayColor: string;
    nextOverlayOpacity: number;
    nextOverlayGrad1: string;
    nextOverlayGrad2: string;
    nextOverlayAngle: number;
    nextDarkOverlayStrength: number;
  }>) => {
    if (!selected?.path) return;

    const nextFit = (overrides?.nextFit ?? imageFit ?? 'cover').trim();
    const nextPosition = (overrides?.nextPosition ?? imagePosition).trim();
    const nextWidth = (overrides?.nextWidth ?? imageWidth).trim();
    const nextMinWidth = (overrides?.nextMinWidth ?? imageMinWidth).trim();
    const nextHeight = (overrides?.nextHeight ?? imageHeight).trim();
    const nextMinHeight = (overrides?.nextMinHeight ?? imageMinHeight).trim();
    const nextMaxWidth = (overrides?.nextMaxWidth ?? imageMaxWidth).trim();
    const nextMaxHeight = (overrides?.nextMaxHeight ?? imageMaxHeight).trim();
    const nextAspectRatio = (overrides?.nextAspectRatio ?? imageAspectRatio).trim();
    const nextOverlayMode = overrides?.nextOverlayMode ?? overlayMode;
    const nextOverlayColor = overrides?.nextOverlayColor ?? overlayColor;
    const nextOverlayOpacity = overrides?.nextOverlayOpacity ?? overlayOpacity;
    const nextOverlayGrad1 = overrides?.nextOverlayGrad1 ?? overlayGrad1;
    const nextOverlayGrad2 = overrides?.nextOverlayGrad2 ?? overlayGrad2;
    const nextOverlayAngle = overrides?.nextOverlayAngle ?? overlayAngle;
    const nextDarkOverlayStrength = overrides?.nextDarkOverlayStrength ?? darkOverlayStrength;

    // target the explicitly discovered image path (inner img) if present, otherwise fall back to the selected.path
    const targetPath = selectedImagePath || selected.path;

    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const targetEl = doc.querySelector(targetPath);
      if (!targetEl) return;

      if ((targetEl.tagName || '').toLowerCase() === 'img') {
        applyMutation(targetPath, (el) => {
          const img = el as HTMLImageElement;
          if (nextFit) {
            img.style.objectFit = nextFit;
          }

          if (nextPosition) {
            img.style.objectPosition = nextPosition;
          } else {
            img.style.removeProperty('object-position');
          }

          if (nextWidth) {
            img.style.width = nextWidth;
          } else {
            img.style.removeProperty('width');
          }

          if (nextMinWidth) {
            img.style.minWidth = nextMinWidth;
          } else {
            img.style.removeProperty('min-width');
          }

          if (nextHeight) {
            img.style.height = nextHeight;
          } else {
            img.style.removeProperty('height');
          }

          if (nextMinHeight) {
            img.style.minHeight = nextMinHeight;
          } else {
            img.style.removeProperty('min-height');
          }

          if (nextMaxWidth) {
            img.style.maxWidth = nextMaxWidth;
          } else {
            img.style.removeProperty('max-width');
          }

          if (nextMaxHeight) {
            img.style.maxHeight = nextMaxHeight;
          } else {
            img.style.removeProperty('max-height');
          }

          if (nextAspectRatio) {
            img.style.aspectRatio = nextAspectRatio;
          } else {
            img.style.removeProperty('aspect-ratio');
          }

          const parent = img.parentElement as HTMLElement | null;
          if (parent) {
            const computedParent = window.getComputedStyle(parent);
            if (computedParent.position === 'static') {
              parent.style.position = 'relative';
            }

            let overlayEl = parent.querySelector(':scope > [data-cf-image-overlay="true"]') as HTMLDivElement | null;
            if (nextOverlayMode === 'none') {
              if (overlayEl) overlayEl.remove();
            } else {
              if (!overlayEl) {
                overlayEl = img.ownerDocument.createElement('div');
                overlayEl.setAttribute('data-cf-image-overlay', 'true');
                overlayEl.style.position = 'absolute';
                overlayEl.style.inset = '0';
                overlayEl.style.pointerEvents = 'none';
                overlayEl.style.zIndex = '2';
                parent.appendChild(overlayEl);
              }

              if (nextOverlayMode === 'gradient') {
                overlayEl.style.background = `linear-gradient(${nextOverlayAngle}deg, ${hexToRgba(nextOverlayGrad1, nextOverlayOpacity)} 0%, ${hexToRgba(nextOverlayGrad2, nextOverlayOpacity)} 100%)`;
              } else if (nextOverlayMode === 'dark') {
                overlayEl.style.background = hexToRgba('#000000', nextDarkOverlayStrength);
              } else if (nextOverlayMode === 'mask') {
                overlayEl.style.background = `linear-gradient(${hexToRgba(nextOverlayColor, Math.max(0, Math.min(100, Math.round(nextOverlayOpacity * 0.7))))}, ${hexToRgba(nextOverlayColor, nextOverlayOpacity)})`;
              } else {
                overlayEl.style.background = hexToRgba(nextOverlayColor, nextOverlayOpacity);
              }
            }
          }
        });
        return;
      }

      // treat as background-image container
      applyMutation(targetPath, (el) => {
        const target = el as HTMLElement;
        if (nextFit) {
          target.style.backgroundSize = nextFit === 'cover' ? 'cover' : nextFit === 'contain' ? 'contain' : nextFit;
        } else {
          target.style.removeProperty('background-size');
        }
        if (nextPosition) {
          target.style.backgroundPosition = nextPosition;
        } else {
          target.style.removeProperty('background-position');
        }
        if (nextWidth) {
          target.style.width = nextWidth;
        } else {
          target.style.removeProperty('width');
        }
        if (nextMinWidth) {
          target.style.minWidth = nextMinWidth;
        } else {
          target.style.removeProperty('min-width');
        }
        if (nextHeight) {
          target.style.height = nextHeight;
        } else {
          target.style.removeProperty('height');
        }
        if (nextMinHeight) {
          target.style.minHeight = nextMinHeight;
        } else {
          target.style.removeProperty('min-height');
        }
        if (nextMaxWidth) {
          target.style.maxWidth = nextMaxWidth;
        } else {
          target.style.removeProperty('max-width');
        }
        if (nextMaxHeight) {
          target.style.maxHeight = nextMaxHeight;
        } else {
          target.style.removeProperty('max-height');
        }
        if (nextAspectRatio) {
          target.style.aspectRatio = nextAspectRatio;
        } else {
          target.style.removeProperty('aspect-ratio');
        }

        const currentBgUrl = (() => {
          const match = (target.style.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/i);
          return match ? match[1] : '';
        })();
        if (currentBgUrl) {
          target.style.backgroundImage = composeBackgroundImageWithOverlay({
            imageUrl: currentBgUrl,
            overlayMode: nextOverlayMode,
            overlayColor: nextOverlayColor,
            overlayOpacity: nextOverlayOpacity,
            overlayGrad1: nextOverlayGrad1,
            overlayGrad2: nextOverlayGrad2,
            overlayAngle: nextOverlayAngle,
            darkOpacity: nextDarkOverlayStrength,
          });
        }
      });
    } catch (e) {
      // ignore
    }
  };

  const applyContainerSizingLive = (overrides?: Partial<{
    nextWidth: string;
    nextMinWidth: string;
    nextHeight: string;
    nextMinHeight: string;
    nextMaxWidth: string;
    nextMaxHeight: string;
    nextPaddingTop: string;
    nextPaddingBottom: string;
    nextPaddingLeft: string;
    nextPaddingRight: string;
    nextMarginTop: string;
    nextMarginBottom: string;
    nextMarginLeft: string;
    nextMarginRight: string;
    nextBorderWidth: string;
    nextBorderColor: string;
    nextBorderRadius: string;
    nextAlignItems: string;
    nextJustifyContent: string;
    nextDisplay: string;
    nextFlexDirection: string;
    nextFlexWrap: string;
    nextGap: string;
    nextGridTemplateColumns: string;
    nextGridGap: string;
    nextGridAutoFlow: string;
  }>) => {
    const targetPath = selectedWrapperPath || selected?.path;
    if (!targetPath || !overrides) return; // do nothing unless explicit overrides provided

    const has = (k: string) => Object.prototype.hasOwnProperty.call(overrides, k as any);

    try {
      applyMutation(targetPath, (el) => {
        const t = el as HTMLElement;

        if (has('nextWidth')) {
          const v = (overrides.nextWidth || '').trim();
          if (v) t.style.width = v; else t.style.removeProperty('width');
        }

        if (has('nextMinWidth')) {
          const v = (overrides.nextMinWidth || '').trim();
          if (v) t.style.minWidth = v; else t.style.removeProperty('min-width');
        }

        if (has('nextHeight')) {
          const v = (overrides.nextHeight || '').trim();
          if (v) t.style.height = v; else t.style.removeProperty('height');
        }

        if (has('nextMinHeight')) {
          const v = (overrides.nextMinHeight || '').trim();
          if (v) t.style.minHeight = v; else t.style.removeProperty('min-height');
        }

        if (has('nextMaxWidth')) {
          const v = (overrides.nextMaxWidth || '').trim();
          if (v) t.style.maxWidth = v; else t.style.removeProperty('max-width');
        }

        if (has('nextMaxHeight')) {
          const v = (overrides.nextMaxHeight || '').trim();
          if (v) t.style.maxHeight = v; else t.style.removeProperty('max-height');
        }

        if (has('nextPaddingLeft')) {
          const v = (overrides.nextPaddingLeft || '').trim();
          if (v) t.style.paddingLeft = v; else t.style.removeProperty('padding-left');
        }

        if (has('nextPaddingTop')) {
          const v = (overrides.nextPaddingTop || '').trim();
          if (v) t.style.paddingTop = v; else t.style.removeProperty('padding-top');
        }

        if (has('nextPaddingBottom')) {
          const v = (overrides.nextPaddingBottom || '').trim();
          if (v) t.style.paddingBottom = v; else t.style.removeProperty('padding-bottom');
        }

        if (has('nextPaddingRight')) {
          const v = (overrides.nextPaddingRight || '').trim();
          if (v) t.style.paddingRight = v; else t.style.removeProperty('padding-right');
        }

        if (has('nextMarginTop')) {
          const v = (overrides.nextMarginTop || '').trim();
          if (v) t.style.marginTop = v; else t.style.removeProperty('margin-top');
        }

        if (has('nextMarginBottom')) {
          const v = (overrides.nextMarginBottom || '').trim();
          if (v) t.style.marginBottom = v; else t.style.removeProperty('margin-bottom');
        }

        if (has('nextMarginLeft')) {
          const v = (overrides.nextMarginLeft || '').trim();
          if (v) t.style.marginLeft = v; else t.style.removeProperty('margin-left');
        }

        if (has('nextMarginRight')) {
          const v = (overrides.nextMarginRight || '').trim();
          if (v) t.style.marginRight = v; else t.style.removeProperty('margin-right');
        }

        if (has('nextBorderWidth')) {
          const v = (overrides.nextBorderWidth || '').trim();
          if (v) t.style.borderWidth = v; else t.style.removeProperty('border-width');
        }

        if (has('nextBorderColor')) {
          const v = (overrides.nextBorderColor || '').trim();
          if (v) t.style.borderColor = v; else t.style.removeProperty('border-color');
        }

        if (has('nextBorderRadius')) {
          const v = (overrides.nextBorderRadius || '').trim();
          if (v) t.style.borderRadius = v; else t.style.removeProperty('border-radius');
        }

        if (has('nextDisplay')) {
          const v = (overrides.nextDisplay || '').trim();
          if (v) t.style.display = v; else t.style.removeProperty('display');
        }

        if (has('nextFlexDirection')) {
          const v = (overrides.nextFlexDirection || '').trim();
          if (v) t.style.flexDirection = v; else t.style.removeProperty('flex-direction');
        }

        if (has('nextFlexWrap')) {
          const v = (overrides.nextFlexWrap || '').trim();
          if (v) t.style.flexWrap = v; else t.style.removeProperty('flex-wrap');
        }

        if (has('nextGap')) {
          const v = (overrides.nextGap || '').trim();
          if (v) t.style.gap = v; else t.style.removeProperty('gap');
        }

        if (has('nextGridTemplateColumns')) {
          const v = (overrides.nextGridTemplateColumns || '').trim();
          if (v) t.style.gridTemplateColumns = v; else t.style.removeProperty('grid-template-columns');
        }

        if (has('nextGridGap')) {
          const v = (overrides.nextGridGap || '').trim();
          if (v) t.style.gridGap = v; else t.style.removeProperty('grid-gap');
        }

        if (has('nextGridAutoFlow')) {
          const v = (overrides.nextGridAutoFlow || '').trim();
          if (v) t.style.gridAutoFlow = v; else t.style.removeProperty('grid-auto-flow');
        }

        if (has('nextAlignItems')) {
          const v = (overrides.nextAlignItems || '').trim();
          if (v) t.style.alignItems = v; else t.style.removeProperty('align-items');
        }

        if (has('nextJustifyContent')) {
          const v = (overrides.nextJustifyContent || '').trim();
          if (v) t.style.justifyContent = v; else t.style.removeProperty('justify-content');
        }

        if (t.style.boxSizing === '') t.style.boxSizing = 'border-box';
      });
    } catch (e) {
      // ignore
    }
  };

  const applyAnchorLinkLive = (overrides?: Partial<{
    nextHref: string;
    nextTarget: string;
    nextRel: string;
    nextDownload: string; // relative path or empty to remove
  }>) => {
    if (!selected?.path || selected.tag !== 'a') return;
    const nextHref = overrides?.nextHref ?? hrefValue;
    const nextTarget = overrides?.nextTarget ?? linkTarget;
    const nextRel = overrides?.nextRel ?? linkRel;
    const nextDownload = overrides?.nextDownload ?? fileDownloadPath;

    applyMutation(selected.path, (el) => {
        if (el.tagName.toLowerCase() === 'a') {
        const anchor = el as HTMLAnchorElement;
        anchor.setAttribute('href', nextHref || '#');

        if (!nextTarget || nextTarget === '_self') {
          anchor.removeAttribute('target');
        } else {
          anchor.setAttribute('target', nextTarget);
        }

        if (!nextRel.trim()) {
          anchor.removeAttribute('rel');
        } else {
          anchor.setAttribute('rel', nextRel.trim());
        }
        // handle download attribute
        if (nextDownload && nextDownload.trim()) {
          // set the download attribute to the filename portion if possible
          try {
            const name = nextDownload.split('/').pop() || nextDownload;
            anchor.setAttribute('download', name);
          } catch {
            anchor.setAttribute('download', '');
          }
        } else {
          anchor.removeAttribute('download');
        }
      }
    });
  };

  const duplicateSection = () => {
    const sectionPath = selected?.sectionPath;
    if (!sectionPath) return;

    applyMutation(sectionPath, (el) => {
      const copy = el.cloneNode(true) as Element;
      el.insertAdjacentElement('afterend', copy);
    });
  };

  const moveSectionUp = () => {
    const sectionPath = selected?.sectionPath;
    if (!sectionPath) return;

    applyMutation(sectionPath, (el) => {
      const previous = el.previousElementSibling;
      if (previous) {
        previous.before(el);
      }
    });
  };

  const moveSectionDown = () => {
    const sectionPath = selected?.sectionPath;
    if (!sectionPath) return;

    applyMutation(sectionPath, (el) => {
      const next = el.nextElementSibling;
      if (next) {
        next.after(el);
      }
    });
  };

  const applyColorsLive = (overrides?: Partial<{
    nextTextColor: string;
    nextTextOpacity: number;
    nextBgColor: string;
    nextBgOpacity: number;
    nextMode: 'solid' | 'gradient' | 'image';
    nextBgImageUrl: string;
    nextBgImageSize: string;
    nextBgImagePosition: string;
    nextBgImageRepeat: string;
    nextOverlayMode: OverlayMode;
    nextOverlayColor: string;
    nextOverlayOpacity: number;
    nextOverlayGrad1: string;
    nextOverlayGrad2: string;
    nextOverlayAngle: number;
    nextDarkOverlayStrength: number;
    nextGrad1: string;
    nextGrad2: string;
    nextAngle: number;
  }>) => {
    if (!selected?.path) return;
    const nextTextColor = overrides?.nextTextColor ?? textColor;
    const nextTextOpacity = overrides?.nextTextOpacity ?? textOpacity;
    const nextBgColor = overrides?.nextBgColor ?? bgColor;
    const nextBgOpacity = overrides?.nextBgOpacity ?? bgOpacity;
    const nextMode = overrides?.nextMode ?? sectionBgMode;
    const nextBgImageUrl = overrides?.nextBgImageUrl ?? bgImageUrl;
    const nextBgImageSize = overrides?.nextBgImageSize ?? bgImageSize;
    const nextBgImagePosition = overrides?.nextBgImagePosition ?? bgImagePosition;
    const nextBgImageRepeat = overrides?.nextBgImageRepeat ?? bgImageRepeat;
    const nextOverlayMode = overrides?.nextOverlayMode ?? overlayMode;
    const nextOverlayColor = overrides?.nextOverlayColor ?? overlayColor;
    const nextOverlayOpacity = overrides?.nextOverlayOpacity ?? overlayOpacity;
    const nextOverlayGrad1 = overrides?.nextOverlayGrad1 ?? overlayGrad1;
    const nextOverlayGrad2 = overrides?.nextOverlayGrad2 ?? overlayGrad2;
    const nextOverlayAngle = overrides?.nextOverlayAngle ?? overlayAngle;
    const nextDarkOverlayStrength = overrides?.nextDarkOverlayStrength ?? darkOverlayStrength;
    const nextGrad1 = overrides?.nextGrad1 ?? gradientColor1;
    const nextGrad2 = overrides?.nextGrad2 ?? gradientColor2;
    const nextAngle = overrides?.nextAngle ?? gradientAngle;

    applyMutation(selected.path, (el) => {
      const target = el as HTMLElement;
      const isHeroText = ['h1', 'p'].includes(target.tagName.toLowerCase())
        && Boolean(target.closest('#top, #hero, .hero-section, .hero-carousel, header[id*="hero"], section[id*="hero"]'));
      const nextColor = hexToRgba(nextTextColor, nextTextOpacity);
      if (isHeroText) {
        target.style.setProperty('color', nextColor, 'important');
      } else {
        target.style.color = nextColor;
      }
      if (nextMode === 'gradient') {
        target.style.backgroundColor = '';
        target.style.backgroundImage = `linear-gradient(${nextAngle}deg, ${hexToRgba(nextGrad1, nextBgOpacity)} 0%, ${hexToRgba(nextGrad2, nextBgOpacity)} 100%)`;
      } else if (nextMode === 'image') {
        target.style.backgroundColor = '';
        target.style.backgroundImage = composeBackgroundImageWithOverlay({
          imageUrl: nextBgImageUrl,
          overlayMode: nextOverlayMode,
          overlayColor: nextOverlayColor,
          overlayOpacity: nextOverlayOpacity,
          overlayGrad1: nextOverlayGrad1,
          overlayGrad2: nextOverlayGrad2,
          overlayAngle: nextOverlayAngle,
          darkOpacity: nextDarkOverlayStrength,
        });
        if (nextBgImageSize) target.style.backgroundSize = nextBgImageSize;
        if (nextBgImagePosition) target.style.backgroundPosition = nextBgImagePosition;
        if (nextBgImageRepeat) target.style.backgroundRepeat = nextBgImageRepeat;
      } else {
        target.style.backgroundImage = '';
        target.style.backgroundColor = hexToRgba(nextBgColor, nextBgOpacity);
      }
    });
  };

  const applyElementFormattingLive = (overrides?: Partial<{
    nextFontFamily: string;
    nextFontSize: number;
    nextFontWeight: number;
    nextTextAlign: string;
    nextLineHeight: string;
    nextWhiteSpace: string;
    nextOverflowWrap: string;
    nextWordBreak: string;
    nextTextWrap: string;
    nextBorderRadius: number;
  }>) => {
    if (!selected?.path || !overrides) return;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(overrides, k as any);

    applyMutation(selected.path, (el) => {
      const t = el as HTMLElement;
      const isHeroText = ['h1', 'p'].includes(t.tagName.toLowerCase())
        && Boolean(t.closest('#top, #hero, .hero-section, .hero-carousel, header[id*="hero"], section[id*="hero"]'));
      const setTextStyle = (prop: string, value: string) => {
        if (isHeroText) {
          t.style.setProperty(prop, value, 'important');
        } else {
          t.style.setProperty(prop, value);
        }
      };
      if (has('nextFontFamily')) {
        const v = (overrides.nextFontFamily || '').trim();
        if (v) setTextStyle('font-family', v); else t.style.removeProperty('font-family');
      }
      if (has('nextFontSize')) {
        setTextStyle('font-size', `${(overrides.nextFontSize || 0)}px`);
      }
      if (has('nextFontWeight')) {
        const v = String(overrides.nextFontWeight ?? '');
        if (v) setTextStyle('font-weight', v); else t.style.removeProperty('font-weight');
      }
      if (has('nextTextAlign')) {
        const v = overrides.nextTextAlign || '';
        if (v) setTextStyle('text-align', v); else t.style.removeProperty('text-align');
      }
      if (has('nextLineHeight')) {
        const v = (overrides.nextLineHeight || '').trim();
        if (v) setTextStyle('line-height', v); else t.style.removeProperty('line-height');
      }
      if (has('nextWhiteSpace')) {
        const v = (overrides.nextWhiteSpace || '').trim();
        if (v) setTextStyle('white-space', v); else t.style.removeProperty('white-space');
      }
      if (has('nextOverflowWrap')) {
        const v = (overrides.nextOverflowWrap || '').trim();
        if (v) setTextStyle('overflow-wrap', v); else t.style.removeProperty('overflow-wrap');
      }
      if (has('nextWordBreak')) {
        const v = (overrides.nextWordBreak || '').trim();
        if (v) setTextStyle('word-break', v); else t.style.removeProperty('word-break');
      }
      if (has('nextTextWrap')) {
        const v = (overrides.nextTextWrap || '').trim();
        if (v) setTextStyle('text-wrap', v); else t.style.removeProperty('text-wrap');
      }
      if (has('nextBorderRadius')) {
        const v = (overrides.nextBorderRadius !== undefined && overrides.nextBorderRadius !== null) ? `${overrides.nextBorderRadius}px` : '';
        if (v) t.style.borderRadius = v; else t.style.removeProperty('border-radius');
      }
    });
  };

  const applySectionSpacingLive = (overrides?: Partial<{
    nextPaddingTop: number;
    nextPaddingBottom: number;
    nextPaddingLeft: number;
    nextPaddingRight: number;
    nextMarginTop: number;
    nextMarginBottom: number;
    nextMarginLeft: number;
    nextMarginRight: number;
  }>) => {
    if (!selected?.sectionPath) return;
    const nextPaddingTop = overrides?.nextPaddingTop ?? paddingTop;
    const nextPaddingBottom = overrides?.nextPaddingBottom ?? paddingBottom;
    const nextPaddingLeft = overrides?.nextPaddingLeft ?? paddingLeft;
    const nextPaddingRight = overrides?.nextPaddingRight ?? paddingRight;
    const nextMarginTop = overrides?.nextMarginTop ?? marginTop;
    const nextMarginBottom = overrides?.nextMarginBottom ?? marginBottom;
    const nextMarginLeft = overrides?.nextMarginLeft ?? marginLeft;
    const nextMarginRight = overrides?.nextMarginRight ?? marginRight;

    applyMutation(selected.sectionPath, (el) => {
      (el as HTMLElement).style.paddingTop = `${nextPaddingTop}px`;
      (el as HTMLElement).style.paddingBottom = `${nextPaddingBottom}px`;
      (el as HTMLElement).style.paddingLeft = `${nextPaddingLeft}px`;
      (el as HTMLElement).style.paddingRight = `${nextPaddingRight}px`;
      (el as HTMLElement).style.marginTop = `${nextMarginTop}px`;
      (el as HTMLElement).style.marginBottom = `${nextMarginBottom}px`;
      (el as HTMLElement).style.marginLeft = `${nextMarginLeft}px`;
      (el as HTMLElement).style.marginRight = `${nextMarginRight}px`;
    });
  };

  const applySectionBackgroundLive = (overrides?: Partial<{
    nextBgOpacity: number;
    nextBgColor: string;
    nextMode: 'solid' | 'gradient' | 'image';
    nextBgImageUrl: string;
    nextBgImageSize: string;
    nextBgImagePosition: string;
    nextBgImageRepeat: string;
    nextOverlayMode: OverlayMode;
    nextOverlayColor: string;
    nextOverlayOpacity: number;
    nextOverlayGrad1: string;
    nextOverlayGrad2: string;
    nextOverlayAngle: number;
    nextDarkOverlayStrength: number;
    nextGrad1: string;
    nextGrad2: string;
    nextAngle: number;
  }>) => {
    if (!selected?.sectionPath) return;
    const nextBgOpacity = overrides?.nextBgOpacity ?? bgOpacity;
    const nextBgColor = overrides?.nextBgColor ?? bgColor;
    const nextMode = overrides?.nextMode ?? sectionBgMode;
    const nextBgImageUrl = overrides?.nextBgImageUrl ?? bgImageUrl;
    const nextBgImageSize = overrides?.nextBgImageSize ?? bgImageSize;
    const nextBgImagePosition = overrides?.nextBgImagePosition ?? bgImagePosition;
    const nextBgImageRepeat = overrides?.nextBgImageRepeat ?? bgImageRepeat;
    const nextOverlayMode = overrides?.nextOverlayMode ?? overlayMode;
    const nextOverlayColor = overrides?.nextOverlayColor ?? overlayColor;
    const nextOverlayOpacity = overrides?.nextOverlayOpacity ?? overlayOpacity;
    const nextOverlayGrad1 = overrides?.nextOverlayGrad1 ?? overlayGrad1;
    const nextOverlayGrad2 = overrides?.nextOverlayGrad2 ?? overlayGrad2;
    const nextOverlayAngle = overrides?.nextOverlayAngle ?? overlayAngle;
    const nextDarkOverlayStrength = overrides?.nextDarkOverlayStrength ?? darkOverlayStrength;
    const nextGrad1 = overrides?.nextGrad1 ?? gradientColor1;
    const nextGrad2 = overrides?.nextGrad2 ?? gradientColor2;
    const nextAngle = overrides?.nextAngle ?? gradientAngle;

    applyMutation(selected.sectionPath, (el) => {
      if (nextMode === 'gradient') {
        (el as HTMLElement).style.backgroundColor = '';
        (el as HTMLElement).style.backgroundImage = `linear-gradient(${nextAngle}deg, ${hexToRgba(nextGrad1, nextBgOpacity)} 0%, ${hexToRgba(nextGrad2, nextBgOpacity)} 100%)`;
      } else if (nextMode === 'image') {
        (el as HTMLElement).style.backgroundColor = '';
        (el as HTMLElement).style.backgroundImage = composeBackgroundImageWithOverlay({
          imageUrl: nextBgImageUrl,
          overlayMode: nextOverlayMode,
          overlayColor: nextOverlayColor,
          overlayOpacity: nextOverlayOpacity,
          overlayGrad1: nextOverlayGrad1,
          overlayGrad2: nextOverlayGrad2,
          overlayAngle: nextOverlayAngle,
          darkOpacity: nextDarkOverlayStrength,
        });
        if (nextBgImageSize) (el as HTMLElement).style.backgroundSize = nextBgImageSize;
        if (nextBgImagePosition) (el as HTMLElement).style.backgroundPosition = nextBgImagePosition;
        if (nextBgImageRepeat) (el as HTMLElement).style.backgroundRepeat = nextBgImageRepeat;
      } else {
        (el as HTMLElement).style.backgroundImage = '';
        (el as HTMLElement).style.backgroundColor = hexToRgba(nextBgColor, nextBgOpacity);
      }
    });
  };

  const removeSection = () => {
    const sectionPath = selected?.sectionPath;
    if (!sectionPath) return;
    applyMutation(sectionPath, (el) => {
      el.remove();
    });
    setSelected(null);
  };

  const removeElement = () => {
    const elPath = selected?.path;
    if (!elPath) return;
    applyMutation(elPath, (el) => {
      el.remove();
    });
    setSelected(null);
  };

  const isSelectedSection = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !selected) return false;
      if (!selected.sectionPath) return false;
      const sectionEl = doc.querySelector(selected.sectionPath);
      if (!sectionEl) return false;
      const selEl = selected.path ? doc.querySelector(selected.path) : null;
      if (!selEl) return false;
      return selEl === sectionEl;
    } catch (e) {
      return false;
    }
  };

  const isHeroSelected = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !selected?.path) return false;
      const el = doc.querySelector(selected.path) as HTMLElement | null;
      if (!el) return false;
      return Boolean(el.closest('#top, #hero, .hero-section, .hero-carousel, header[id*="hero"], section[id*="hero"]'));
    } catch {
      return false;
    }
  };

  const resolveHeroTargetPath = (): { path: string; isBackground: boolean } | null => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return null;

      const heroSelectors = ['#top', '#hero', '.hero-section', '.hero-carousel', 'header[id*="hero"]', 'section[id*="hero"]'];
      let heroEl: Element | null = null;
      for (const selector of heroSelectors) {
        heroEl = doc.querySelector(selector);
        if (heroEl) break;
      }

      if (!heroEl && selected?.path) {
        const selectedEl = doc.querySelector(selected.path) as HTMLElement | null;
        heroEl = selectedEl?.closest('#top, #hero, .hero-section, .hero-carousel, header[id*="hero"], section[id*="hero"]') as Element | null;
      }

      if (!heroEl) return null;

      const computePath = (el: Element): string => {
        if (!el || el === doc.documentElement) return 'html';
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && node !== doc.body) {
          const tag = node.tagName.toLowerCase();
          let idx = 1;
          let sib = node.previousElementSibling as Element | null;
          while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling as Element | null; }
          parts.unshift(`${tag}:nth-of-type(${idx})`);
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };

      const addMarker = (el: Element): string => {
        const marker = `cfsel-hero-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        (el as HTMLElement).setAttribute('data-cf-editor-id', marker);
        lastEditorMarkerRef.current = marker;
        return `[data-cf-editor-id="${marker}"]`;
      };

      // Priority 1: <img> with src inside the hero
      const img = heroEl.querySelector('img');
      if (img && img.getAttribute('src')) {
        return { path: computePath(img), isBackground: false };
      }

      // Priority 2: element with inline background-image (hero first, then child containers)
      const candidates = [heroEl, ...Array.from(heroEl.querySelectorAll('div, section, header, span, figure'))];
      for (const el of candidates) {
        const inlineBg = (el as HTMLElement).style?.backgroundImage;
        if (inlineBg && inlineBg !== 'none' && inlineBg.trim() !== '') {
          return { path: addMarker(el), isBackground: true };
        }
      }

      // Priority 3: element with computed background-image from CSS
      for (const el of candidates) {
        const cs = doc.defaultView?.getComputedStyle(el as Element);
        if (cs?.backgroundImage && cs.backgroundImage !== 'none') {
          return { path: addMarker(el), isBackground: true };
        }
      }

      // Fallback: marker on the hero container itself
      return { path: addMarker(heroEl), isBackground: true };
    } catch {
      // ignore
    }
    return null;
  };

  const handleReplaceHeroImage = async () => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first.');
      return;
    }

    const result = resolveHeroTargetPath();
    if (!result) {
      toast.error('Could not find hero image. Click inside the hero section first, then try again.');
      return;
    }

    setPanelOpen(true);
    setEditorTab('element');
    setSelectedImagePath(result.path);
    setSelectedBackground(result.isBackground);
    setShowAssetManager(true);
    await refreshAssets();
  };

  const refreshAssets = async () => {
    if (!projectId || !userId) return;
    setAssetsLoading(true);
    try {
      const data = await getProjectAssets(projectId, userId);
      const nextAssetsPublicUrl = data.assetsPublicUrl || buildAssetsFolderUrl(projectPublicUrl);
      setAssetsPublicUrl(nextAssetsPublicUrl);
      setAssets((data.assets || []).map((asset) => ({
        ...asset,
        url: resolveAssetUrl(asset.url, projectPublicUrl, nextAssetsPublicUrl, asset.name),
      })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load assets folder.');
    } finally {
      setAssetsLoading(false);
    }
  };

  const handleImportAssetFromUrl = async (rawUrl: string, context: 'element' | 'background') => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first to import assets.');
      return;
    }

    const nextUrl = (rawUrl || '').trim();
    if (!nextUrl) {
      toast.error('Enter a valid image URL first.');
      return;
    }

    setAssetUrlImporting(true);
    try {
      const result = await uploadProjectAssetsFromUrls(projectId, userId, [nextUrl]);
      const uploadedAsset = result.uploaded?.[0];

      if (!uploadedAsset?.url) {
        const maybeSkipped = (result as any)?.skipped?.[0];
        if (maybeSkipped?.reason) {
          throw new Error(`Could not import URL: ${maybeSkipped.reason}`);
        }
        throw new Error('Could not import URL. The source may block download or is not a supported file type.');
      }

      if (context === 'background') {
        const resolvedUploadedUrl = resolveAssetUrl(uploadedAsset.url, projectPublicUrl, assetsPublicUrl);
        setBgAssetUrlInput('');
        setSectionBgMode('image');
        setBgImageUrl(resolvedUploadedUrl);
        if (isSelectedSection()) {
          applySectionBackgroundLive({ nextMode: 'image', nextBgImageUrl: resolvedUploadedUrl });
        } else {
          applyColorsLive({ nextMode: 'image', nextBgImageUrl: resolvedUploadedUrl });
        }
      } else {
        const resolvedUploadedUrl = resolveAssetUrl(uploadedAsset.url, projectPublicUrl, assetsPublicUrl);
        setAssetUrlInput('');
        setSrcValue(resolvedUploadedUrl);
        applyImageLive(resolvedUploadedUrl);
      }

      await refreshAssets();
      toast.success('Image URL imported to assets successfully.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import URL to assets.');
    } finally {
      setAssetUrlImporting(false);
    }
  };

  const applyBrandPaletteColor = (color: string) => {
    const next = (color || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next)) return;

    if (isSelectedSection() || selected?.tag === 'section') {
      setBgColor(next);
      applySectionBackgroundLive({ nextMode: 'solid', nextBgColor: next });
      return;
    }

    setTextColor(next);
    applyColorsLive({ nextTextColor: next });
  };

  const renderBrandPaletteSwatches = (
    keyPrefix: string,
    onApply: (color: string) => void,
    titleBuilder?: (color: string) => string,
  ) => {
    if (brandPalette.length === 0) return null;

    return (
      <div className="mb-1 flex flex-wrap gap-1">
        {brandPalette.map((color) => (
          <button
            key={`${keyPrefix}-${color}`}
            type="button"
            className="h-5 w-5 rounded-sm border border-border/70 hover:scale-110 transition-transform"
            style={{ backgroundColor: color }}
            title={titleBuilder ? titleBuilder(color) : `Apply ${color}`}
            onClick={() => onApply(color)}
          />
        ))}
      </div>
    );
  };

  const refreshFiles = async () => {
    if (!projectId || !userId) return '';
    setFilesLoading(true);
    try {
      const data = await getProjectFiles(projectId, userId);
      setFiles(data.files || []);
      const url = data.filesPublicUrl || buildFilesFolderUrl(projectPublicUrl);
      setFilesPublicUrl(url || '');
      return url || '';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load files folder.');
      return '';
    } finally {
      setFilesLoading(false);
    }
  };

  // Keep selectedRef in sync so async file handlers always see the latest selection
  selectedRef.current = selected;

  // NOTE: original `openFilesManager` removed. We'll use `openFilesFolder` (below)

  const handleUploadFiles = async (filesList: FileList | null) => {
    if (!filesList || !projectId || !userId) return;
    const fileArray = Array.from(filesList);
    if (fileArray.length === 0) return;

    const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
    const oversized = fileArray.filter(f => f.size > MAX_BYTES);
    const allowedFiles = fileArray.filter(f => f.size <= MAX_BYTES);

    if (oversized.length > 0) {
      const names = oversized.map(f => f.name).join(', ');
      toast.error(`The following files exceed the 15MB limit and were not uploaded: ${names}`);
    }

    if (allowedFiles.length === 0) {
      if (fileFolderInputRef.current) fileFolderInputRef.current.value = '';
      return;
    }

    setFilesUploading(true);
    try {
      const uploadResult = await uploadProjectFiles(projectId, userId, allowedFiles);
      toast.success(`${allowedFiles.length} file(s) uploaded to the files folder.`);

      // Auto-link behavior: if an anchor element is selected, attach the first uploaded file automatically.
      // Use selectedRef to avoid stale closure issues in async callbacks.
      const currentSelected = selectedRef.current;
      const firstUploaded = uploadResult.uploaded?.[0];
      if (currentSelected?.tag === 'a' && firstUploaded?.url) {
        const rel = toRelativeFilePath(firstUploaded.url);
        setHrefValue(rel);
        setFileDownloadPath(rel);
        applyAnchorLinkLive({ nextHref: rel, nextDownload: rel });
        toast.success(`Link applied automatically to the selected element: ${firstUploaded.name}.`);
      } else if (firstUploaded?.url) {
        toast.info('File uploaded. To auto-apply it to a button/link, select an <a> element on the page before uploading.');
      }

      await refreshFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload files.');
    } finally {
      setFilesUploading(false);
      if (fileFolderInputRef.current) fileFolderInputRef.current.value = '';
    }
  };

  const handleDeleteFile = async (fileName: string) => {
    if (!projectId || !userId) return;
    try {
      await deleteProjectFile(projectId, userId, fileName);
      toast.success(`Removed ${fileName} from files.`);
      await refreshFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete file.');
    }
  };

  const openAssetManager = async () => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first to manage assets.');
      return;
    }
    setShowAssetManager(true);
    await refreshAssets();
  };

  const openBgAssetManager = async () => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first to manage assets.');
      return;
    }
    setPanelOpen(true);
    setEditorTab('element');
    setShowBgAssetManager(true);
    await refreshAssets();
  };

  // Duplicated from `openAssetManager` but for the project's files folder.
  // This is intentionally a separate function to avoid touching the assets logic.
  const openFilesFolder = async () => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first to manage files.');
      return;
    }
    toast.success('Opening files folder...');
    // Ensure the editor panel and the Element tab are visible like assets flow
    setPanelOpen(true);
    setEditorTab('element');
    setShowFilesFolder(true);

    await refreshFiles();

    // scroll to panel once mounted
    const start = Date.now();
    const attemptScroll = () => {
      try {
        if (filesPanelRef.current) {
          filesPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      } catch {
        // ignore
      }
      if (Date.now() - start < 1000) requestAnimationFrame(attemptScroll);
    };
    requestAnimationFrame(attemptScroll);
  };

  const toRelativeFilePath = (fullUrl: string) => {
    try {
      if (!fullUrl) return fullUrl;
      // prefer explicit /files/ segment
      const idx = fullUrl.indexOf('/files/');
      if (idx !== -1) return fullUrl.slice(idx);
      if (filesPublicUrl && fullUrl.startsWith(filesPublicUrl)) {
        const rest = fullUrl.slice(filesPublicUrl.length);
        const normalized = rest.startsWith('/') ? rest.slice(1) : rest;
        return `/files/${normalized}`;
      }
      // fallback: return filename under /files/
      const parts = fullUrl.split('/');
      const last = parts[parts.length - 1] || fullUrl;
      return `/files/${last}`;
    } catch {
      return fullUrl;
    }
  };

  const handleUploadAssets = async (files: FileList | null) => {
    if (!files || !projectId || !userId) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setAssetsUploading(true);
    try {
      const result = await uploadProjectAssets(projectId, userId, fileArray);
      const uploadedCount = result.uploaded?.length || 0;
      const skipped = result.skipped || [];

      if (uploadedCount > 0) {
        toast.success(`${uploadedCount} file(s) uploaded to assets folder.`);
      }

      if (skipped.length > 0) {
        const firstReason = skipped[0]?.reason || 'Unknown upload error.';
        toast.error(`${skipped.length} file(s) failed to upload. ${firstReason}`);
      }

      if (uploadedCount === 0 && skipped.length === 0) {
        toast.error('No files were uploaded. Please try again.');
      }

      await refreshAssets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload assets.');
    } finally {
      setAssetsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (bgFileInputRef.current) bgFileInputRef.current.value = '';
    }
  };

  const handleDeleteAsset = async (fileName: string) => {
    if (!projectId || !userId) return;
    try {
      await deleteProjectAssetFile(projectId, userId, fileName);
      toast.success(`Removed ${fileName} from assets.`);
      await refreshAssets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete asset.');
    }
  };

  const promptToFileNameBase = (prompt: string) => {
    const normalized = (prompt || 'generated-image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const clamped = (normalized || 'generated-image').slice(0, 64).replace(/-+$/g, '');
    return clamped || 'generated-image';
  };

  const dataUrlToFile = (dataUrl: string, fileNameBase: string) => {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid generated image data.');
    }

    const mime = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
    };
    const ext = extMap[mime.toLowerCase()] || 'png';
    return new File([bytes], `${fileNameBase}-${Date.now()}.${ext}`, { type: mime });
  };

  const handleGenerateImage = async () => {
    if (aiGenerating) return;

    const prompt = aiPrompt.trim();
    if (!prompt) {
      toast.error('Write a prompt before generating an image.');
      return;
    }

    setAiGenerating(true);
    setAiGeneratingError('');

    try {
      const runGenerate = () => generateImages({
        purpose: prompt,
        businessName: 'Website',
        businessCategory: 'General',
        style: 'modern',
        websiteType: 'landing',
        referenceImageUrl: selected?.tag === 'img' ? srcValue || undefined : undefined,
      });

      const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        let timeoutId: number | null = null;
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('Image generation timed out.')), timeoutMs);
        });

        try {
          return await Promise.race([promise, timeoutPromise]);
        } finally {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
      };

      let result;
      try {
        result = await withTimeout(runGenerate(), 35000);
      } catch (firstError) {
        const firstMessage = firstError instanceof Error ? firstError.message.toLowerCase() : '';
        const retryable = firstMessage.includes('timeout') || firstMessage.includes('network') || firstMessage.includes('429') || firstMessage.includes('503');
        if (!retryable) throw firstError;
        result = await withTimeout(runGenerate(), 35000);
      }

      if (!result?.imageUrl) {
        throw new Error('Image provider returned no image URL.');
      }

      const id = nextGeneratedImageIdRef.current;
      nextGeneratedImageIdRef.current += 1;

      setAiGeneratedImages((prev) => [
        {
          id,
          prompt,
          imageUrl: result.imageUrl,
          provider: result.provider,
          model: result.model,
          reason: result.reason,
          fallback: result.fallback,
        },
        ...prev,
      ]);
      setAiPrompt('');
      toast.success('Image generated. Use Add to place it in assets.');
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to generate image.';
      const message = rawMessage.toLowerCase().includes('timed out')
        ? 'Image generation timed out. Please try a shorter prompt or retry in a few seconds.'
        : rawMessage;
      setAiGeneratingError(message);
      toast.error(message);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAddGeneratedImageToAssets = async (item: {
    id: number;
    prompt: string;
    imageUrl: string;
  }) => {
    if (!projectId || !userId) {
      toast.error('Save/publish this project first to add generated images to assets.');
      return;
    }

    setAddingGeneratedImageId(item.id);
    try {
      const fileBase = promptToFileNameBase(item.prompt);
      const uploadResult = item.imageUrl.startsWith('data:image/')
        ? await uploadProjectAssets(projectId, userId, [dataUrlToFile(item.imageUrl, fileBase)])
        : await uploadProjectAssetsFromUrls(projectId, userId, [item.imageUrl], [`${fileBase}-${Date.now()}.png`]);
      const uploadedAsset = uploadResult.uploaded?.[0];
      if (!uploadedAsset?.url) {
        throw new Error('Upload to assets returned no file.');
      }

      setShowAssetManager(true);
      await refreshAssets();

      const resolvedUploadedUrl = resolveAssetUrl(uploadedAsset.url, projectPublicUrl, assetsPublicUrl);
      setSrcValue(resolvedUploadedUrl);
      applyImageLive(resolvedUploadedUrl);
      toast.success('Generated image added to assets and applied to the selected image.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add generated image to assets.');
    } finally {
      setAddingGeneratedImageId(null);
    }
  };

  const previewWidthClass = previewMode === 'desktop'
    ? 'w-full'
    : previewMode === 'tablet'
      ? 'w-[900px] max-w-full'
      : 'w-[430px] max-w-full';

  const iframeEl = (
    <div className="relative h-full w-full bg-muted/20">
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md border border-border/70 bg-background/95 p-1 shadow">
        <Button size="sm" variant={previewMode === 'desktop' ? 'default' : 'ghost'} className="h-8 px-2" onClick={() => setPreviewMode('desktop')}>
          <Monitor className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={previewMode === 'tablet' ? 'default' : 'ghost'} className="h-8 px-2" onClick={() => setPreviewMode('tablet')}>
          <Tablet className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={previewMode === 'mobile' ? 'default' : 'ghost'} className="h-8 px-2" onClick={() => setPreviewMode('mobile')}>
          <Smartphone className="h-4 w-4" />
        </Button>
      </div>

      <div className={`relative mx-auto h-full transition-all duration-300 ${previewWidthClass}`}>
        {!livePreviewUrl && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/95 p-6 text-center">
            <div className="max-w-md space-y-2">
              <p className="text-sm font-semibold">Live mode requires a published URL</p>
              <p className="text-sm text-muted-foreground">
                Publish this project first so the editor can open and edit the real hosted page.
              </p>
            </div>
          </div>
        )}
        {!iframeReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 rounded-xl">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading preview...</p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={livePreviewUrl || 'about:blank'}
          onLoad={handleIframeLoad}
          className="h-full w-full"
          style={{ opacity: iframeReady ? 1 : 0, transition: 'opacity 0.3s' }}
          title="Visual Editor Preview"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
        />
      </div>
    </div>
  );

  // Painel de sessões do site (sections)
  const [sectionsPanelOpen, setSectionsPanelOpen] = useState(true);
  const [sectionsList, setSectionsList] = useState<Array<{path: string, title: string}>>([]);

  // Atualiza lista de sections sempre que html muda
  useEffect(() => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const nodes = Array.from(doc.querySelectorAll('section'));
      setSectionsList(nodes.map((el, idx) => ({
        path: (() => {
          let node: HTMLElement | null = el as HTMLElement, parts = [];
          while (node && node.nodeType === 1 && node !== doc.body) {
            const tag = node.tagName.toLowerCase();
            let i = 1, p: HTMLElement | null = node;
            while ((p = p.previousElementSibling as HTMLElement | null)) if (p.tagName === node.tagName) i++;
            parts.unshift(`${tag}:nth-of-type(${i})`);
            node = node.parentElement as HTMLElement | null;
          }
          return 'body > ' + parts.join(' > ');
        })(),
        title: el.querySelector('h2,h1')?.textContent?.trim() || `Sessão ${idx+1}`
      })));
    } catch { setSectionsList([]); }
  }, [html]);

  // Selecionar sessão no painel lateral: não deve preencher campo de texto
  const selectSection = (path: string) => {
    const doc = iframeRef.current?.contentDocument;
    const sectionEl = doc?.querySelector(path) as HTMLElement | null;
    const sectionStyles = sectionEl ? window.getComputedStyle(sectionEl) : null;

    setSelected({
      path,
      sectionPath: path,
      tag: 'section',
      text: '',
      fontFamily: '',
      lineHeight: '',
      whiteSpace: '',
      overflowWrap: '',
      wordBreak: '',
      textWrap: '',
      src: '', objectFit: '', objectPosition: '', width: '', minWidth: '', height: '', minHeight: '', maxWidth: '', maxHeight: '', aspectRatio: '', href: '', target: '', rel: '', color: '', backgroundColor: '', backgroundImage: '', backgroundSize: '', backgroundPosition: '', backgroundRepeat: '', paddingTop: '', paddingBottom: '', marginTop: '', marginBottom: '', fontSize: '', fontWeight: '', textAlign: '', borderRadius: '', isButtonLike: false
    });
    setTextValue('');
    setHrefValue('');
    setLinkTarget('_self');
    setLinkRel('');
    setSrcValue('');
    setImageFit('cover');
    setImagePosition('center');
    setImageWidth('');
    setImageMinWidth('');
    setImageHeight('');
    setImageMinHeight('');
    setImageMaxWidth('');
    setImageMaxHeight('');
    setImageAspectRatio('');
    setTextColor('#111111');
    setTextOpacity(100);
    setBgColor('#ffffff');
    setBgOpacity(100);
    setBgImageUrl('');
    setBgImageSize('cover');
    setBgImagePosition('center');
    setBgImageRepeat('no-repeat');
    setOverlayMode('none');
    setOverlayColor('#000000');
    setOverlayOpacity(35);
    setOverlayGrad1('#000000');
    setOverlayGrad2('#ffffff');
    setOverlayAngle(180);
    setDarkOverlayStrength(45);
    setGradientColor1('#ffffff');
    setGradientColor2('#e2e8f0');
    setGradientAngle(135);
    setSectionBgMode('solid');
    setPaddingTop(toPxNumber(sectionStyles?.paddingTop || '', 16));
    setPaddingBottom(toPxNumber(sectionStyles?.paddingBottom || '', 16));
    setPaddingLeft(toPxNumber(sectionStyles?.paddingLeft || '', 0));
    setPaddingRight(toPxNumber(sectionStyles?.paddingRight || '', 0));
    setMarginTop(toPxNumber(sectionStyles?.marginTop || '', 0));
    setMarginBottom(toPxNumber(sectionStyles?.marginBottom || '', 0));
    setMarginLeft(toPxNumber(sectionStyles?.marginLeft || '', 0));
    setMarginRight(toPxNumber(sectionStyles?.marginRight || '', 0));
    setFontFamily('');
    setFontSize(16);
    setFontWeight(400);
    setTextAlign('left');
    setLineHeight('');
    setWhiteSpaceMode('normal');
    setOverflowWrapMode('normal');
    setWordBreakMode('normal');
    setTextWrapMode('wrap');
    setBorderRadius(0);
  };

  // Render painel de sessões
  // Drag-and-drop state
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);

  const isTextElementSelected = useMemo(() => {
    if (!selected) return false;
    return TEXT_EDITABLE_TAGS.has(selected.tag);
  }, [selected]);

  const commonFontFamilies = useMemo(() => ([
    { label: 'Inter', value: 'Inter, "Segoe UI", sans-serif' },
    { label: 'Poppins', value: 'Poppins, "Segoe UI", sans-serif' },
    { label: 'Montserrat', value: 'Montserrat, "Segoe UI", sans-serif' },
    { label: 'Roboto', value: 'Roboto, "Segoe UI", sans-serif' },
    { label: 'Open Sans', value: '"Open Sans", "Segoe UI", sans-serif' },
    { label: 'Lato', value: 'Lato, "Segoe UI", sans-serif' },
    { label: 'Merriweather', value: 'Merriweather, Georgia, serif' },
    { label: 'Playfair Display', value: '"Playfair Display", Georgia, serif' },
    { label: 'Source Code Pro', value: '"Source Code Pro", Consolas, monospace' },
  ]), []);

  const normalizeFontToken = (value: string) => value
    .split(',')[0]
    ?.replace(/['"]/g, '')
    .trim()
    .toLowerCase();

  const matchedQuickFont = useMemo(() => {
    const normalized = normalizeFontToken(fontFamily || '');
    const found = commonFontFamilies.find((item) => normalizeFontToken(item.value) === normalized);
    return found ? found.value : null;
  }, [fontFamily, commonFontFamilies]);

  useEffect(() => {
    if (matchedQuickFont) {
      setFontFamilyPickerValue(matchedQuickFont);
      return;
    }

    setFontFamilyPickerValue('__custom__');
    setCustomFontFamilyDraft(fontFamily);
  }, [fontFamily, matchedQuickFont]);

  useEffect(() => {
    if (sectionBgMode !== 'image' && showBgAssetManager) {
      setShowBgAssetManager(false);
    }
  }, [sectionBgMode, showBgAssetManager]);

  const handleDragStart = (idx: number) => setDraggedSectionIdx(idx);
  const handleDragEnd = () => setDraggedSectionIdx(null);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedSectionIdx === null || draggedSectionIdx === targetIdx) return;
    // Move a seção no DOM
    const fromPath = sectionsList[draggedSectionIdx].path;
    const toPath = sectionsList[targetIdx].path;
    applyMutation('body', (body, doc) => {
      const sections = Array.from(body.querySelectorAll('section'));
      const fromEl = doc.querySelector(fromPath);
      const toEl = doc.querySelector(toPath);
      if (!fromEl || !toEl) return;
      // Remove do lugar original
      body.removeChild(fromEl);
      // Inserir antes do alvo
      body.insertBefore(fromEl, toEl);
    });
    setDraggedSectionIdx(null);
  };

  const sectionsPanel = (
    <div className="mb-4 rounded border border-border/60 bg-background">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left font-semibold" onClick={() => setSectionsPanelOpen(v => !v)}>
        {sectionsPanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Site Sections
      </button>
      {sectionsPanelOpen && (
        <>
          <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-border/40 mb-2">
            {PREDEFINED_SECTIONS.map((s) => (
              <Button
                key={s.name}
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-sm justify-start gap-2"
                onClick={() => addPredefinedSection(s.name)}
              >
                <span className="opacity-80">{s.icon}</span>
                <span className="ml-2">{s.label}</span>
              </Button>
            ))}
                {/* Modal para código embed ao adicionar sessão */}
                {showEmbedModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md border border-border">
                      <h3 className="text-lg font-semibold mb-2">Add Embedded Code to Section</h3>
                      <p className="text-xs text-muted-foreground mb-2">Paste any HTML, iframe, widget, or embed code below. It will be inserted inside the new section.</p>
                      <textarea
                        className="w-full min-h-[100px] rounded border border-border bg-muted/10 p-2 text-sm font-mono mb-4"
                        placeholder="&lt;iframe ...&gt;&lt;/iframe&gt; or any HTML..."
                        value={embedCode}
                        onChange={e => setEmbedCode(e.target.value)}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => { setShowEmbedModal(false); setEmbedCode(''); setPendingSectionType(null); }}>Cancel</Button>
                        <Button variant="default" onClick={confirmAddSectionWithEmbed} disabled={!pendingSectionType}>Add Section</Button>
                      </div>
                    </div>
                  </div>
                )}
                {showFilesFolder && (
                  <div className="fixed inset-0 flex items-center justify-center bg-black/40" style={{ zIndex: 99999 }}>
                    <div className="bg-background rounded-lg shadow-lg p-4 w-full max-w-2xl border border-primary/60">
                      <div className="mb-2" />
                      <div className="mb-3 rounded-t px-3 py-2 bg-primary text-white flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Project Files Folder</h3>
                        <Button size="sm" variant="ghost" onClick={() => setShowFilesFolder(false)}>Close</Button>
                      </div>

                      <div className="px-3 py-2">
                        <p className="text-xs text-muted-foreground mb-3">Upload, remove, and copy paths from this project's files folder.</p>
                      </div>

                      <div className="mb-3">
                        <input ref={fileFolderInputRef} type="file" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
                        <Button size="sm" variant="outline" onClick={() => fileFolderInputRef.current?.click()} disabled={filesUploading}><Upload className="mr-2 h-4 w-4" />{filesUploading ? 'Uploading...' : 'Upload files to files folder'}</Button>
                      </div>

                      <div className="max-h-[50vh] overflow-auto space-y-2">
                        {filesLoading ? (
                          <p className="text-xs text-muted-foreground">Loading files...</p>
                        ) : files.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No files in files folder yet.</p>
                        ) : files.map((f) => (
                          <div key={f.name} className="rounded border border-border/60 p-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="truncate text-xs font-medium">{f.name}</p>
                                <p className="text-[11px] text-muted-foreground">{Math.round((f.size || 0) / 1024)} KB</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => {
                                  const rel = toRelativeFilePath(f.url || '');
                                  navigator.clipboard.writeText(rel).then(() => toast.success('File path copied to clipboard (relative)')).catch(() => toast.error('Could not copy path'));
                                }}><Copy className="mr-2 h-4 w-4" />Copy</Button>
                                <Button size="sm" variant="ghost" onClick={async () => {
                                  try {
                                    await downloadFileFromUrl(f.url, f.name);
                                  } catch (e) {
                                    toast.error('Could not download file');
                                  }
                                }}>Open</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleDeleteFile(f.name)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
          </div>
          <ul className="divide-y divide-border/40">
            {sectionsList.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No sections found</li>}
            {sectionsList.map((s, idx) => (
              <li
                key={s.path}
                className={`flex items-center gap-2 px-3 py-2 group hover:bg-muted/40 ${draggedSectionIdx === idx ? 'opacity-50' : ''}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={e => handleDrop(e, idx)}
              >
                <button className="flex-1 text-left truncate" style={{fontWeight: selected?.sectionPath === s.path ? 600 : 400}} onClick={() => selectSection(s.path)}>{s.title}</button>
                <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => moveSection(s.path, 'up')} title="Move up"><ArrowUp size={16} /></Button>
                <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => moveSection(s.path, 'down')} title="Move down"><ArrowDown size={16} /></Button>
                <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => { applyMutation(s.path, el => el.remove()); }} title="Remove"><Trash2 size={16} /></Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  const panelContent = (
    <div className="text-sm space-y-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          className={`px-3 py-1 rounded-md text-sm font-medium ${editorTab === 'element' ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
          onClick={() => setEditorTab('element')}
        >
          Element
        </button>
        <button
          className={`px-3 py-1 rounded-md text-sm font-medium ${editorTab === 'sections' ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
          onClick={() => setEditorTab('sections')}
        >
          Sections
        </button>
      </div>

      {editorTab === 'sections' ? (
        sectionsPanel
      ) : (
        !selected ? (
          <>
            <div className="rounded-md border border-border/50 bg-muted/20 p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">No element selected</p>
              <p className="text-xs text-muted-foreground">Click any text, image, or section in the preview to start editing it.</p>
              <ul className="text-xs text-muted-foreground space-y-1 mt-2 list-disc pl-4">
                <li>Click a <strong>heading or paragraph</strong> to edit its text and style</li>
                <li>Click an <strong>image</strong> to swap it from your assets folder</li>
                <li>Click inside the <strong>hero section</strong> to see the Replace Image shortcut</li>
                <li>Switch to <strong>Sections</strong> tab above to reorder or remove sections</li>
              </ul>
            </div>
            {showFilesFolder && (
              <div ref={filesPanelRef} className="space-y-3 rounded-md border border-primary/60 p-3 mt-3" style={{ position: 'relative', zIndex: 99999 }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Project Files Folder</p>
                  <Button size="sm" variant="ghost" onClick={() => setShowFilesFolder(false)}>Close</Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Upload, remove, and copy paths from this project's files folder. Files uploaded here are not generated by the AI — you upload them from your computer.
                </p>

                <input
                  ref={fileFolderInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadFiles(e.target.files)}
                />

                <Button size="sm" variant="outline" className="w-full" disabled={filesUploading} onClick={() => fileFolderInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {filesUploading ? 'Uploading...' : 'Upload files to files folder'}
                </Button>

                {filesPublicUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const rel = '/files/';
                      navigator.clipboard.writeText(rel).then(() => {
                        toast.success('Files folder path copied to clipboard (relative)');
                      }).catch(() => toast.error('Could not copy path'));
                    }}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" /> Copy Files Folder Path
                  </Button>
                )}

                <div className="max-h-56 space-y-2 overflow-auto">
                  {filesLoading ? (
                    <p className="text-xs text-muted-foreground">Loading files...</p>
                  ) : files.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No files in files folder yet.</p>
                  ) : files.map((f) => (
                    <div key={f.name} className="rounded border border-border/60 p-2">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{f.name}</p>
                          <p className="text-[11px] text-muted-foreground">{Math.round((f.size || 0) / 1024)} KB</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!f.url) return;
                            const rel = toRelativeFilePath(f.url);
                            navigator.clipboard.writeText(rel).then(() => {
                              toast.success('File path copied to clipboard (relative)');
                              if (selected && selected.tag === 'a') {
                                setHrefValue(rel);
                                setFileDownloadPath(rel);
                                applyAnchorLinkLive({ nextHref: rel, nextDownload: rel });
                              }
                            }).catch(() => toast.error('Could not copy path'));
                          }}
                        >
                          <Copy className="mr-2 h-4 w-4" /> Copy URL
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}>Open</Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteFile(f.name)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Selection Context</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-xs">{selected.tag}</Badge>
              {selected.sectionPath && <Badge variant="outline" className="text-xs">in section</Badge>}
              {sectionBgMode === 'image' && <Badge variant="outline" className="text-xs">background image mode</Badge>}
            </div>
          </div>

          {isTextElementSelected && (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <p className="text-sm font-medium">Quick Edit</p>
              <Label htmlFor="cf-edit-text" className="text-xs text-muted-foreground">Text</Label>
              <Textarea
                id="cf-edit-text"
                value={textValue}
                onChange={(e) => {
                  const next = e.target.value;
                  setTextValue(next);
                  applyTextLive(next);
                }}
                rows={3}
              />
            </div>
          )}

          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-sm font-medium">Appearance</p>
            <Label className="text-xs text-muted-foreground">Colors</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cf-text-color" className="text-xs text-muted-foreground">Text</Label>
                {renderBrandPaletteSwatches(
                  'text-color',
                  (color) => {
                    setTextColor(color);
                    applyColorsLive({ nextTextColor: color });
                  },
                  (color) => `Apply ${color} as text color`,
                )}
                <Input
                  id="cf-text-color"
                  type="color"
                  value={textColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTextColor(next);
                    applyColorsLive({ nextTextColor: next });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cf-bg-color" className="text-xs text-muted-foreground">Background</Label>
                {renderBrandPaletteSwatches(
                  'bg-color',
                  (color) => {
                    setBgColor(color);
                    applyColorsLive({ nextBgColor: color });
                  },
                  (color) => `Apply ${color} as background color`,
                )}
                <Input
                  id="cf-bg-color"
                  type="color"
                  value={bgColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBgColor(next);
                    applyColorsLive({ nextBgColor: next });
                  }}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cf-text-opacity" className="text-xs text-muted-foreground">Text transparency ({textOpacity}%)</Label>
                <Input
                  id="cf-text-opacity"
                  type="range"
                  min={0}
                  max={100}
                  value={textOpacity}
                  onChange={(e) => {
                    const next = Number(e.target.value || 100);
                    setTextOpacity(next);
                    applyColorsLive({ nextTextOpacity: next });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="cf-bg-opacity" className="text-xs text-muted-foreground">BG transparency ({bgOpacity}%)</Label>
                <Input
                  id="cf-bg-opacity"
                  type="range"
                  min={0}
                  max={100}
                  value={bgOpacity}
                  onChange={(e) => {
                    const next = Number(e.target.value || 100);
                    setBgOpacity(next);
                    applyColorsLive({ nextBgOpacity: next });
                  }}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cf-color-mode" className="text-xs text-muted-foreground">Background mode</Label>
              <select
                id="cf-color-mode"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={sectionBgMode}
                onChange={(e) => {
                  const next = e.target.value as 'solid' | 'gradient' | 'image';
                  setSectionBgMode(next);
                  if (next !== 'image') setShowBgAssetManager(false);
                  applyColorsLive({ nextMode: next });
                }}
              >
                <option value="solid">Solid color</option>
                <option value="gradient">Gradient</option>
                <option value="image">Background image</option>
              </select>
            </div>
            {sectionBgMode === 'gradient' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="cf-bg-grad-1" className="text-xs text-muted-foreground">Gradient color 1</Label>
                  {renderBrandPaletteSwatches(
                    'bg-grad-1',
                    (color) => {
                      setGradientColor1(color);
                      applyColorsLive({ nextGrad1: color });
                    },
                    (color) => `Apply ${color} as gradient color 1`,
                  )}
                  <Input
                    id="cf-bg-grad-1"
                    type="color"
                    value={gradientColor1}
                    onChange={(e) => {
                      const next = e.target.value;
                      setGradientColor1(next);
                      applyColorsLive({ nextGrad1: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-bg-grad-2" className="text-xs text-muted-foreground">Gradient color 2</Label>
                  {renderBrandPaletteSwatches(
                    'bg-grad-2',
                    (color) => {
                      setGradientColor2(color);
                      applyColorsLive({ nextGrad2: color });
                    },
                    (color) => `Apply ${color} as gradient color 2`,
                  )}
                  <Input
                    id="cf-bg-grad-2"
                    type="color"
                    value={gradientColor2}
                    onChange={(e) => {
                      const next = e.target.value;
                      setGradientColor2(next);
                      applyColorsLive({ nextGrad2: next });
                    }}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="cf-bg-grad-angle" className="text-xs text-muted-foreground">Gradient angle ({gradientAngle}deg)</Label>
                  <Input
                    id="cf-bg-grad-angle"
                    type="range"
                    min={0}
                    max={360}
                    value={gradientAngle}
                    onChange={(e) => {
                      const next = Number(e.target.value || 135);
                      setGradientAngle(next);
                      applyColorsLive({ nextAngle: next });
                    }}
                  />
                </div>
              </div>
            )}
            {sectionBgMode === 'image' && (
              <div className="space-y-2">
                <Label htmlFor="cf-bg-image-url" className="text-xs text-muted-foreground">Background image URL</Label>
                <Input
                  id="cf-bg-image-url"
                  value={bgImageUrl}
                  placeholder="/assets/your-image.jpg"
                  onChange={(e) => {
                    const next = e.target.value;
                    setBgImageUrl(next);
                    applyColorsLive({ nextBgImageUrl: next });
                  }}
                />
                <Button className="w-full" size="sm" variant="secondary" onClick={openBgAssetManager}>
                  <FolderOpen className="mr-2 h-4 w-4" /> Open Assets Folder
                </Button>

                <div className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-3">
                  <div>
                    <Label htmlFor="cf-bg-image-size" className="text-xs text-muted-foreground">Fit</Label>
                    <select
                      id="cf-bg-image-size"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bgImageSize}
                      onChange={(e) => {
                        const next = e.target.value;
                        setBgImageSize(next);
                        applyColorsLive({ nextBgImageSize: next });
                      }}
                    >
                      <option value="cover">cover</option>
                      <option value="contain">contain</option>
                      <option value="auto">auto</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="cf-bg-image-position" className="text-xs text-muted-foreground">Object position</Label>
                    <select
                      id="cf-bg-image-position"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bgImagePosition}
                      onChange={(e) => {
                        const next = e.target.value;
                        setBgImagePosition(next);
                        const parsed = parsePositionToPercent(next);
                        setBgImagePositionX(parsed.x);
                        setBgImagePositionY(parsed.y);
                        applyColorsLive({ nextBgImagePosition: next });
                      }}
                    >
                      <option value="center">center</option>
                      <option value="top">top</option>
                      <option value="bottom">bottom</option>
                      <option value="left">left</option>
                      <option value="right">right</option>
                      <option value="top left">top left</option>
                      <option value="top right">top right</option>
                      <option value="bottom left">bottom left</option>
                      <option value="bottom right">bottom right</option>
                    </select>
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="cf-bg-image-position-x" className="text-xs text-muted-foreground">Position X ({bgImagePositionX}%)</Label>
                      <Input
                        id="cf-bg-image-position-x"
                        type="range"
                        min={0}
                        max={100}
                        value={bgImagePositionX}
                        onChange={(e) => {
                          const nextX = Number(e.target.value || 50);
                          const nextPos = formatPositionFromPercent(nextX, bgImagePositionY);
                          setBgImagePositionX(nextX);
                          setBgImagePosition(nextPos);
                          applyColorsLive({ nextBgImagePosition: nextPos });
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cf-bg-image-position-y" className="text-xs text-muted-foreground">Position Y ({bgImagePositionY}%)</Label>
                      <Input
                        id="cf-bg-image-position-y"
                        type="range"
                        min={0}
                        max={100}
                        value={bgImagePositionY}
                        onChange={(e) => {
                          const nextY = Number(e.target.value || 50);
                          const nextPos = formatPositionFromPercent(bgImagePositionX, nextY);
                          setBgImagePositionY(nextY);
                          setBgImagePosition(nextPos);
                          applyColorsLive({ nextBgImagePosition: nextPos });
                        }}
                      />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-bg-image-repeat" className="text-xs text-muted-foreground">Repeat</Label>
                    <select
                      id="cf-bg-image-repeat"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bgImageRepeat}
                      onChange={(e) => {
                        const next = e.target.value;
                        setBgImageRepeat(next);
                        applyColorsLive({ nextBgImageRepeat: next });
                      }}
                    >
                      <option value="no-repeat">no-repeat</option>
                      <option value="repeat">repeat</option>
                      <option value="repeat-x">repeat-x</option>
                      <option value="repeat-y">repeat-y</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <Label htmlFor="cf-bg-overlay-mode" className="text-xs text-muted-foreground">Image Overlay</Label>
                  <select
                    id="cf-bg-overlay-mode"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={overlayMode}
                    onChange={(e) => {
                      const next = e.target.value as OverlayMode;
                      setOverlayMode(next);
                      applyColorsLive({ nextOverlayMode: next });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="color">Color Overlay</option>
                    <option value="gradient">Gradient Overlay</option>
                    <option value="dark">Dark Overlay</option>
                    <option value="mask">Image Mask / Layer</option>
                  </select>

                  {(overlayMode === 'color' || overlayMode === 'mask') && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="cf-bg-overlay-color" className="text-xs text-muted-foreground">Overlay color</Label>
                        {renderBrandPaletteSwatches(
                          'bg-overlay-color',
                          (color) => {
                            setOverlayColor(color);
                            applyColorsLive({ nextOverlayColor: color });
                          },
                          (color) => `Apply ${color} as overlay color`,
                        )}
                        <Input
                          id="cf-bg-overlay-color"
                          type="color"
                          value={overlayColor}
                          onChange={(e) => {
                            const next = e.target.value;
                            setOverlayColor(next);
                            applyColorsLive({ nextOverlayColor: next });
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="cf-bg-overlay-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                        <Input
                          id="cf-bg-overlay-opacity"
                          type="range"
                          min={0}
                          max={100}
                          value={overlayOpacity}
                          onChange={(e) => {
                            const next = Number(e.target.value || 0);
                            setOverlayOpacity(next);
                            applyColorsLive({ nextOverlayOpacity: next });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {overlayMode === 'gradient' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="cf-bg-overlay-grad-1" className="text-xs text-muted-foreground">Gradient color 1</Label>
                        {renderBrandPaletteSwatches(
                          'bg-overlay-grad-1',
                          (color) => {
                            setOverlayGrad1(color);
                            applyColorsLive({ nextOverlayGrad1: color });
                          },
                          (color) => `Apply ${color} as overlay gradient color 1`,
                        )}
                        <Input
                          id="cf-bg-overlay-grad-1"
                          type="color"
                          value={overlayGrad1}
                          onChange={(e) => {
                            const next = e.target.value;
                            setOverlayGrad1(next);
                            applyColorsLive({ nextOverlayGrad1: next });
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="cf-bg-overlay-grad-2" className="text-xs text-muted-foreground">Gradient color 2</Label>
                        {renderBrandPaletteSwatches(
                          'bg-overlay-grad-2',
                          (color) => {
                            setOverlayGrad2(color);
                            applyColorsLive({ nextOverlayGrad2: color });
                          },
                          (color) => `Apply ${color} as overlay gradient color 2`,
                        )}
                        <Input
                          id="cf-bg-overlay-grad-2"
                          type="color"
                          value={overlayGrad2}
                          onChange={(e) => {
                            const next = e.target.value;
                            setOverlayGrad2(next);
                            applyColorsLive({ nextOverlayGrad2: next });
                          }}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="cf-bg-overlay-angle" className="text-xs text-muted-foreground">Gradient angle ({overlayAngle}deg)</Label>
                        <Input
                          id="cf-bg-overlay-angle"
                          type="range"
                          min={0}
                          max={360}
                          value={overlayAngle}
                          onChange={(e) => {
                            const next = Number(e.target.value || 180);
                            setOverlayAngle(next);
                            applyColorsLive({ nextOverlayAngle: next });
                          }}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="cf-bg-overlay-grad-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                        <Input
                          id="cf-bg-overlay-grad-opacity"
                          type="range"
                          min={0}
                          max={100}
                          value={overlayOpacity}
                          onChange={(e) => {
                            const next = Number(e.target.value || 0);
                            setOverlayOpacity(next);
                            applyColorsLive({ nextOverlayOpacity: next });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {overlayMode === 'dark' && (
                    <div>
                      <Label htmlFor="cf-bg-overlay-dark" className="text-xs text-muted-foreground">Dark strength ({darkOverlayStrength}%)</Label>
                      <Input
                        id="cf-bg-overlay-dark"
                        type="range"
                        min={0}
                        max={100}
                        value={darkOverlayStrength}
                        onChange={(e) => {
                          const next = Number(e.target.value || 0);
                          setDarkOverlayStrength(next);
                          applyColorsLive({ nextDarkOverlayStrength: next });
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {showBgAssetManager && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Project Assets Folder (Background)</p>
                  <Button size="sm" variant="ghost" onClick={() => setShowBgAssetManager(false)}>Close</Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Upload, remove, and select files from this project's assets folder for background image.
                </p>

                <input
                  ref={bgFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.bmp,.ico,.tif,.tiff,.heic,.heif"
                  className="hidden"
                  onChange={(e) => handleUploadAssets(e.target.files)}
                />

                <Button size="sm" variant="outline" className="w-full" disabled={assetsUploading} onClick={() => bgFileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {assetsUploading ? 'Uploading...' : 'Upload files to assets'}
                </Button>

                <div className="space-y-2 rounded-md border border-border/60 p-2">
                  <Label htmlFor="cf-bg-asset-url" className="text-xs text-muted-foreground">Import image URL to assets</Label>
                  <div className="flex gap-2">
                    <Input
                      id="cf-bg-asset-url"
                      value={bgAssetUrlInput}
                      placeholder="https://.../image.jpg"
                      onChange={(e) => setBgAssetUrlInput(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={assetUrlImporting}
                      onClick={() => handleImportAssetFromUrl(bgAssetUrlInput, 'background')}
                    >
                      {assetUrlImporting ? 'Importing...' : 'Import URL'}
                    </Button>
                  </div>
                </div>

                {(projectPublicUrl || assetsPublicUrl) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const url = assetsPublicUrl || buildAssetsFolderUrl(projectPublicUrl);
                      if (!url) {
                        toast.error('Assets URL not available for this project yet.');
                        return;
                      }
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" /> Open Assets URL
                  </Button>
                )}

                <div className="max-h-56 space-y-2 overflow-auto">
                  {assetsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading assets...</p>
                  ) : assets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No files in assets folder yet.</p>
                  ) : assets.map((asset) => (
                    <div key={`bg-${asset.name}`} className="rounded border border-border/60 p-2">
                      <div className="mb-2 flex items-center gap-2">
                        <img
                          src={resolveAssetUrl(asset.url, projectPublicUrl, assetsPublicUrl, asset.name)}
                          alt={asset.name}
                          className="h-10 w-10 rounded object-cover"
                          onError={(event) => {
                            const nextCandidate = resolveNextAssetUrlCandidate(
                              event.currentTarget.currentSrc || event.currentTarget.src,
                              asset.url,
                              projectPublicUrl,
                              assetsPublicUrl,
                              asset.name,
                            );
                            if (nextCandidate && nextCandidate !== event.currentTarget.src) {
                              event.currentTarget.src = nextCandidate;
                            }
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{asset.name}</p>
                          <p className="text-[11px] text-muted-foreground">{Math.round((asset.size || 0) / 1024)} KB</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSectionBgMode('image');
                            const resolvedAssetUrl = resolveAssetUrl(asset.url, projectPublicUrl, assetsPublicUrl, asset.name);
                            setBgImageUrl(resolvedAssetUrl);
                            if (isSelectedSection()) {
                              applySectionBackgroundLive({ nextMode: 'image', nextBgImageUrl: resolvedAssetUrl });
                            } else {
                              applyColorsLive({ nextMode: 'image', nextBgImageUrl: resolvedAssetUrl });
                            }
                          }}
                        >
                          <ImagePlus className="mr-2 h-4 w-4" /> Use
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteAsset(asset.name)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isHeroSelected() && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div>
                <p className="text-sm font-medium">Hero Section</p>
                <p className="text-xs text-muted-foreground mt-0.5">Quickly replace the main hero image from your uploaded assets.</p>
              </div>
              <Button
                className="w-full"
                size="sm"
                variant="default"
                onClick={handleReplaceHeroImage}
                title="Find the hero image automatically and open the assets picker to replace it"
              >
                <ImagePlus className="mr-2 h-4 w-4" /> Replace Hero Image
              </Button>
            </div>
          )}

          {(selected.tag === 'img' || selectedBackground) && (
            <div className="flex flex-col gap-2">
              <div className="rounded-md border border-border/60 p-3 space-y-2">
                <div>
                  <p className="text-sm font-medium">Image</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Paste a URL or pick from your uploaded assets.</p>
                </div>
                <Label htmlFor="cf-image-src" className="text-xs text-muted-foreground">Image URL</Label>
                <Input
                  id="cf-image-src"
                  value={srcValue}
                  placeholder="https://… or /projects/slug/assets/image.jpg"
                  onChange={(e) => {
                    const next = e.target.value;
                    setSrcValue(next);
                    applyImageLive(next);
                  }}
                />
                <Button
                  className="w-full"
                  size="sm"
                  variant="secondary"
                  onClick={openAssetManager}
                  title="Browse and select from images already uploaded to this project's assets folder"
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> Pick from Assets Folder
                </Button>
              </div>


              <div className="order-3 space-y-2 rounded-md border border-border/60 p-3">
                <p className="text-sm font-medium">Image Formatting</p>
                <div>
                  <Label htmlFor="cf-image-fit" className="text-xs text-muted-foreground">Fit</Label>
                  <select
                    id="cf-image-fit"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={imageFit}
                    onChange={(e) => {
                      const next = e.target.value;
                      setImageFit(next);
                      applyImageFormattingLive({ nextFit: next });
                    }}
                  >
                    <option value="cover">cover</option>
                    <option value="contain">contain</option>
                    <option value="fill">fill</option>
                    <option value="none">none</option>
                    <option value="scale-down">scale-down</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cf-image-position" className="text-xs text-muted-foreground">Object position</Label>
                  <select
                    id="cf-image-position"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={imagePosition}
                    onChange={(e) => {
                      const next = e.target.value;
                      setImagePosition(next);
                      const parsed = parsePositionToPercent(next);
                      setImagePositionX(parsed.x);
                      setImagePositionY(parsed.y);
                      applyImageFormattingLive({ nextPosition: next });
                    }}
                  >
                    <option value="center">center</option>
                    <option value="top">top</option>
                    <option value="bottom">bottom</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                    <option value="top left">top left</option>
                    <option value="top right">top right</option>
                    <option value="bottom left">bottom left</option>
                    <option value="bottom right">bottom right</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="cf-image-position-x" className="text-xs text-muted-foreground">Position X ({imagePositionX}%)</Label>
                    <Input
                      id="cf-image-position-x"
                      type="range"
                      min={0}
                      max={100}
                      value={imagePositionX}
                      onChange={(e) => {
                        const nextX = Number(e.target.value || 50);
                        const nextPos = formatPositionFromPercent(nextX, imagePositionY);
                        setImagePositionX(nextX);
                        setImagePosition(nextPos);
                        applyImageFormattingLive({ nextPosition: nextPos });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-image-position-y" className="text-xs text-muted-foreground">Position Y ({imagePositionY}%)</Label>
                    <Input
                      id="cf-image-position-y"
                      type="range"
                      min={0}
                      max={100}
                      value={imagePositionY}
                      onChange={(e) => {
                        const nextY = Number(e.target.value || 50);
                        const nextPos = formatPositionFromPercent(imagePositionX, nextY);
                        setImagePositionY(nextY);
                        setImagePosition(nextPos);
                        applyImageFormattingLive({ nextPosition: nextPos });
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="cf-image-width" className="text-xs text-muted-foreground">Width</Label>
                    <Input
                      id="cf-image-width"
                      value={imageWidth}
                      placeholder="100% or 320px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageWidth(next);
                        applyImageFormattingLive({ nextWidth: next });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-image-min-width" className="text-xs text-muted-foreground">Min width</Label>
                    <Input
                      id="cf-image-min-width"
                      value={imageMinWidth}
                      placeholder="0 or 200px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageMinWidth(next);
                        applyImageFormattingLive({ nextMinWidth: next });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-image-height" className="text-xs text-muted-foreground">Height</Label>
                    <Input
                      id="cf-image-height"
                      value={imageHeight}
                      placeholder="auto or 220px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageHeight(next);
                        applyImageFormattingLive({ nextHeight: next });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-image-min-height" className="text-xs text-muted-foreground">Min height</Label>
                    <Input
                      id="cf-image-min-height"
                      value={imageMinHeight}
                      placeholder="0 or 200px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageMinHeight(next);
                        applyImageFormattingLive({ nextMinHeight: next });
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-image-max-width" className="text-xs text-muted-foreground">Max width</Label>
                    <Input
                      id="cf-image-max-width"
                      value={imageMaxWidth}
                      placeholder="100% or 1200px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageMaxWidth(next);
                        applyImageFormattingLive({ nextMaxWidth: next });
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-image-max-height" className="text-xs text-muted-foreground">Max height</Label>
                    <Input
                      id="cf-image-max-height"
                      value={imageMaxHeight}
                      placeholder="none or 700px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageMaxHeight(next);
                        applyImageFormattingLive({ nextMaxHeight: next });
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-image-aspect-ratio" className="text-xs text-muted-foreground">Aspect ratio</Label>
                    <Input
                      id="cf-image-aspect-ratio"
                      value={imageAspectRatio}
                      placeholder="16 / 9 or 1 / 1"
                      onChange={(e) => {
                        const next = e.target.value;
                        setImageAspectRatio(next);
                        applyImageFormattingLive({ nextAspectRatio: next });
                      }}
                    />
                  </div>
                  <div className="col-span-2 space-y-2 rounded-md border border-border/60 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Image Overlay</p>
                    <div>
                      <Label htmlFor="cf-image-overlay-mode" className="text-xs text-muted-foreground">Overlay type</Label>
                      <select
                        id="cf-image-overlay-mode"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={overlayMode}
                        onChange={(e) => {
                          const next = e.target.value as OverlayMode;
                          setOverlayMode(next);
                          applyImageFormattingLive({ nextOverlayMode: next });
                        }}
                      >
                        <option value="none">None</option>
                        <option value="color">Color Overlay</option>
                        <option value="gradient">Gradient Overlay</option>
                        <option value="dark">Dark Overlay</option>
                        <option value="mask">Image Mask / Layer</option>
                      </select>
                    </div>

                    {(overlayMode === 'color' || overlayMode === 'mask') && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="cf-image-overlay-color" className="text-xs text-muted-foreground">Overlay color</Label>
                          {renderBrandPaletteSwatches(
                            'image-overlay-color',
                            (color) => {
                              setOverlayColor(color);
                              applyImageFormattingLive({ nextOverlayColor: color });
                            },
                            (color) => `Apply ${color} as image overlay color`,
                          )}
                          <Input
                            id="cf-image-overlay-color"
                            type="color"
                            value={overlayColor}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayColor(next);
                              applyImageFormattingLive({ nextOverlayColor: next });
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="cf-image-overlay-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                          <Input
                            id="cf-image-overlay-opacity"
                            type="range"
                            min={0}
                            max={100}
                            value={overlayOpacity}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              setOverlayOpacity(next);
                              applyImageFormattingLive({ nextOverlayOpacity: next });
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {overlayMode === 'gradient' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="cf-image-overlay-grad-1" className="text-xs text-muted-foreground">Gradient color 1</Label>
                          {renderBrandPaletteSwatches(
                            'image-overlay-grad-1',
                            (color) => {
                              setOverlayGrad1(color);
                              applyImageFormattingLive({ nextOverlayGrad1: color });
                            },
                            (color) => `Apply ${color} as image overlay gradient color 1`,
                          )}
                          <Input
                            id="cf-image-overlay-grad-1"
                            type="color"
                            value={overlayGrad1}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayGrad1(next);
                              applyImageFormattingLive({ nextOverlayGrad1: next });
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="cf-image-overlay-grad-2" className="text-xs text-muted-foreground">Gradient color 2</Label>
                          {renderBrandPaletteSwatches(
                            'image-overlay-grad-2',
                            (color) => {
                              setOverlayGrad2(color);
                              applyImageFormattingLive({ nextOverlayGrad2: color });
                            },
                            (color) => `Apply ${color} as image overlay gradient color 2`,
                          )}
                          <Input
                            id="cf-image-overlay-grad-2"
                            type="color"
                            value={overlayGrad2}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayGrad2(next);
                              applyImageFormattingLive({ nextOverlayGrad2: next });
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label htmlFor="cf-image-overlay-angle" className="text-xs text-muted-foreground">Gradient angle ({overlayAngle}deg)</Label>
                          <Input
                            id="cf-image-overlay-angle"
                            type="range"
                            min={0}
                            max={360}
                            value={overlayAngle}
                            onChange={(e) => {
                              const next = Number(e.target.value || 180);
                              setOverlayAngle(next);
                              applyImageFormattingLive({ nextOverlayAngle: next });
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label htmlFor="cf-image-overlay-grad-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                          <Input
                            id="cf-image-overlay-grad-opacity"
                            type="range"
                            min={0}
                            max={100}
                            value={overlayOpacity}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              setOverlayOpacity(next);
                              applyImageFormattingLive({ nextOverlayOpacity: next });
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {overlayMode === 'dark' && (
                      <div>
                        <Label htmlFor="cf-image-overlay-dark" className="text-xs text-muted-foreground">Dark strength ({darkOverlayStrength}%)</Label>
                        <Input
                          id="cf-image-overlay-dark"
                          type="range"
                          min={0}
                          max={100}
                          value={darkOverlayStrength}
                          onChange={(e) => {
                            const next = Number(e.target.value || 0);
                            setDarkOverlayStrength(next);
                            applyImageFormattingLive({ nextDarkOverlayStrength: next });
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="order-2 space-y-3 rounded-md border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Gemini Image Chat</p>
                  <Badge variant="secondary">AI</Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  Describe the image you want. Click Add to download and save it into assets.
                </p>

                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Example: Minimal hero image of a modern architecture studio, neutral palette, clean lighting"
                  rows={3}
                />

                <Button className="w-full" size="sm" onClick={handleGenerateImage} disabled={aiGenerating}>
                  {aiGenerating ? 'Generating...' : 'Generate with Gemini'}
                </Button>

                {aiGeneratingError && (
                  <p className="text-xs text-destructive">{aiGeneratingError}</p>
                )}

                <div className="max-h-72 space-y-2 overflow-auto">
                  {aiGeneratedImages.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No generated images yet.</p>
                  ) : aiGeneratedImages.map((item) => (
                    <div key={item.id} className="rounded border border-border/60 p-2">
                      <p className="mb-2 text-[11px] text-muted-foreground">{item.prompt}</p>
                      <img src={item.imageUrl} alt={item.prompt} className="mb-2 h-28 w-full rounded object-cover" />
                      <div className="mb-2 text-[11px] text-muted-foreground">
                        {(item.provider || 'ai')}{item.model ? ` • ${item.model}` : ''}{item.fallback ? ' • fallback' : ''}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={addingGeneratedImageId === item.id}
                        onClick={() => handleAddGeneratedImageToAssets(item)}
                      >
                        {addingGeneratedImageId === item.id ? 'Adding...' : 'Add to assets'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {showAssetManager && (
                <div className="order-1 space-y-3 rounded-md border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Project Assets Folder</p>
                    <Button size="sm" variant="ghost" onClick={() => setShowAssetManager(false)}>Close</Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Upload, remove, and select files from this project's assets folder.
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.bmp,.ico,.tif,.tiff,.heic,.heif"
                    className="hidden"
                    onChange={(e) => handleUploadAssets(e.target.files)}
                  />

                  <Button size="sm" variant="outline" className="w-full" disabled={assetsUploading} onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    {assetsUploading ? 'Uploading...' : 'Upload files to assets'}
                  </Button>

                  <div className="space-y-2 rounded-md border border-border/60 p-2">
                    <Label htmlFor="cf-asset-url" className="text-xs text-muted-foreground">Import image URL to assets</Label>
                    <div className="flex gap-2">
                      <Input
                        id="cf-asset-url"
                        value={assetUrlInput}
                        placeholder="https://.../image.jpg"
                        onChange={(e) => setAssetUrlInput(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={assetUrlImporting}
                        onClick={() => handleImportAssetFromUrl(assetUrlInput, 'element')}
                      >
                        {assetUrlImporting ? 'Importing...' : 'Import URL'}
                      </Button>
                    </div>
                  </div>

                  {(projectPublicUrl || assetsPublicUrl) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const url = assetsPublicUrl || buildAssetsFolderUrl(projectPublicUrl);
                        if (!url) {
                          toast.error('Assets URL not available for this project yet.');
                          return;
                        }
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" /> Open Assets URL
                    </Button>
                  )}

                  <div className="max-h-56 space-y-2 overflow-auto">
                    {assetsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading assets...</p>
                    ) : assets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No files in assets folder yet.</p>
                    ) : assets.map((asset) => (
                      <div key={asset.name} className="rounded border border-border/60 p-2">
                        <div className="mb-2 flex items-center gap-2">
                          <img
                            src={resolveAssetUrl(asset.url, projectPublicUrl, assetsPublicUrl, asset.name)}
                            alt={asset.name}
                            className="h-10 w-10 rounded object-cover"
                            onError={(event) => {
                              const nextCandidate = resolveNextAssetUrlCandidate(
                                event.currentTarget.currentSrc || event.currentTarget.src,
                                asset.url,
                                projectPublicUrl,
                                assetsPublicUrl,
                                asset.name,
                              );
                              if (nextCandidate && nextCandidate !== event.currentTarget.src) {
                                event.currentTarget.src = nextCandidate;
                              }
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{asset.name}</p>
                            <p className="text-[11px] text-muted-foreground">{Math.round((asset.size || 0) / 1024)} KB</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const resolvedAssetUrl = resolveAssetUrl(asset.url, projectPublicUrl, assetsPublicUrl, asset.name);
                              setSrcValue(resolvedAssetUrl);
                              applyImageLive(resolvedAssetUrl);
                            }}
                          >
                            <ImagePlus className="mr-2 h-4 w-4" /> Use
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDeleteAsset(asset.name)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showFilesFolder && (
                <div ref={filesPanelRef} className="space-y-3 rounded-md border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Project Files Folder</p>
                    <Button size="sm" variant="ghost" onClick={() => setShowFilesFolder(false)}>Close</Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Upload, remove, and copy paths from this project's files folder. Files uploaded here are not generated by the AI — you upload them from your computer.
                  </p>

                  <input
                    ref={fileFolderInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleUploadFiles(e.target.files)}
                  />

                  <Button size="sm" variant="outline" className="w-full" disabled={filesUploading} onClick={() => fileFolderInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    {filesUploading ? 'Uploading...' : 'Upload files to files folder'}
                  </Button>

                  {filesPublicUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const rel = '/files/';
                        navigator.clipboard.writeText(rel).then(() => {
                          toast.success('Files folder path copied to clipboard (relative)');
                        }).catch(() => toast.error('Could not copy path'));
                      }}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" /> Copy Files Folder Path
                    </Button>
                  )}

                  <div className="max-h-56 space-y-2 overflow-auto">
                    {filesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading files...</p>
                    ) : files.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No files in files folder yet.</p>
                    ) : files.map((f) => (
                      <div key={f.name} className="rounded border border-border/60 p-2">
                        <div className="mb-2 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground">{Math.round((f.size || 0) / 1024)} KB</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                if (!f.url) return;
                                const rel = toRelativeFilePath(f.url);
                                navigator.clipboard.writeText(rel).then(() => {
                                  toast.success('File path copied to clipboard (relative)');
                                  // Auto-paste into selected anchor if present
                                  if (selected && selected.tag === 'a') {
                                    setHrefValue(rel);
                                    setFileDownloadPath(rel);
                                    applyAnchorLinkLive({ nextHref: rel, nextDownload: rel });
                                  }
                                }).catch(() => toast.error('Could not copy path'));
                              }}
                          >
                            <Copy className="mr-2 h-4 w-4" /> Copy URL
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}>Open</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDeleteFile(f.name)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <p className="text-sm font-medium">Typography & Element Formatting</p>
            <div className="grid grid-cols-2 gap-2">
              {isTextElementSelected && (
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="cf-font-family-quick" className="text-xs text-muted-foreground">Font family</Label>
                  <select
                    id="cf-font-family-quick"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={fontFamilyPickerValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === '__custom__') {
                        setFontFamilyPickerValue('__custom__');
                        if (customFontFamilyDraft !== fontFamily) {
                          setFontFamily(customFontFamilyDraft);
                          applyElementFormattingLive({ nextFontFamily: customFontFamilyDraft });
                        }
                        return;
                      }

                      setFontFamilyPickerValue(next);
                      setFontFamily(next);
                      applyElementFormattingLive({ nextFontFamily: next });
                    }}
                  >
                    {commonFontFamilies.map((font) => (
                      <option key={font.label} value={font.value}>{font.label}</option>
                    ))}
                    <option value="__custom__">Custom (free input)</option>
                  </select>
                  {fontFamilyPickerValue === '__custom__' && (
                    <Input
                      id="cf-font-family"
                      value={customFontFamilyDraft}
                      placeholder={'Inter, "Segoe UI", sans-serif'}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCustomFontFamilyDraft(next);
                        setFontFamily(next);
                        applyElementFormattingLive({ nextFontFamily: next });
                      }}
                    />
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="cf-font-size" className="text-xs text-muted-foreground">Font size (px)</Label>
                <Input
                  id="cf-font-size"
                  type="number"
                  min={10}
                  max={96}
                  value={fontSize}
                  onChange={(e) => {
                    const next = Number(e.target.value || 16);
                    setFontSize(next);
                    applyElementFormattingLive({ nextFontSize: next });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="cf-font-weight" className="text-xs text-muted-foreground">Weight</Label>
                <Input
                  id="cf-font-weight"
                  type="number"
                  min={100}
                  max={900}
                  step={100}
                  value={fontWeight}
                  onChange={(e) => {
                    const next = Number(e.target.value || 400);
                    setFontWeight(next);
                    applyElementFormattingLive({ nextFontWeight: next });
                  }}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cf-radius" hint="Applies to the selected element (e.g. button, image). Use container radius below to affect wrapper elements.">
                  Element radius (px)
                </FieldLabel>
                <Input
                  id="cf-radius"
                  type="number"
                  min={0}
                  max={80}
                  value={borderRadius}
                  onChange={(e) => {
                    const next = Number(e.target.value || 0);
                    setBorderRadius(next);
                    applyElementFormattingLive({ nextBorderRadius: next });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="cf-align" className="text-xs text-muted-foreground">Text align</Label>
                <select
                  id="cf-align"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={textAlign}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTextAlign(next);
                    applyElementFormattingLive({ nextTextAlign: next });
                  }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                  <option value="justify">Justify</option>
                </select>
              </div>
              {isTextElementSelected && (
                <>
                  <div>
                    <Label htmlFor="cf-line-height" className="text-xs text-muted-foreground">Line height</Label>
                    <Input
                      id="cf-line-height"
                      value={lineHeight}
                      placeholder="1.5 or 24px"
                      onChange={(e) => {
                        const next = e.target.value;
                        setLineHeight(next);
                        applyElementFormattingLive({ nextLineHeight: next });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-white-space" className="text-xs text-muted-foreground">White-space</Label>
                    <select
                      id="cf-white-space"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={whiteSpaceMode}
                      onChange={(e) => {
                        const next = e.target.value;
                        setWhiteSpaceMode(next);
                        applyElementFormattingLive({ nextWhiteSpace: next });
                      }}
                    >
                      <option value="normal">normal</option>
                      <option value="nowrap">nowrap</option>
                      <option value="pre">pre</option>
                      <option value="pre-wrap">pre-wrap</option>
                      <option value="pre-line">pre-line</option>
                      <option value="break-spaces">break-spaces</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="cf-overflow-wrap" className="text-xs text-muted-foreground">Overflow wrap</Label>
                    <select
                      id="cf-overflow-wrap"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={overflowWrapMode}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOverflowWrapMode(next);
                        applyElementFormattingLive({ nextOverflowWrap: next });
                      }}
                    >
                      <option value="normal">normal</option>
                      <option value="break-word">break-word</option>
                      <option value="anywhere">anywhere</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="cf-word-break" className="text-xs text-muted-foreground">Word break</Label>
                    <select
                      id="cf-word-break"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={wordBreakMode}
                      onChange={(e) => {
                        const next = e.target.value;
                        setWordBreakMode(next);
                        applyElementFormattingLive({ nextWordBreak: next });
                      }}
                    >
                      <option value="normal">normal</option>
                      <option value="break-all">break-all</option>
                      <option value="keep-all">keep-all</option>
                      <option value="break-word">break-word</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-text-wrap" className="text-xs text-muted-foreground">Text wrap</Label>
                    <select
                      id="cf-text-wrap"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={textWrapMode}
                      onChange={(e) => {
                        const next = e.target.value;
                        setTextWrapMode(next);
                        applyElementFormattingLive({ nextTextWrap: next });
                      }}
                    >
                      <option value="wrap">wrap</option>
                      <option value="nowrap">nowrap</option>
                      <option value="balance">balance</option>
                      <option value="pretty">pretty</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>

          {/** Container / Div sizing controls — visible when an element is selected */}
          <div className="space-y-3 rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Container / Div Sizing</p>
            </div>

              <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cf-container-width" className="text-xs text-muted-foreground">Width</Label>
                <Input
                  id="cf-container-width"
                  value={containerWidth}
                  placeholder="100% or 1200px"
                  className={cwError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerWidth);
                    setContainerWidth(next);
                    if (!isCssSize(next)) { setCwError(true); toast.error('Width inválido'); return; }
                    setCwError(false);
                    applyContainerSizingLive({ nextWidth: next });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="cf-container-min-width" className="text-xs text-muted-foreground">Min width</Label>
                <Input
                  id="cf-container-min-width"
                  value={containerMinWidth}
                  placeholder="0px or 320px"
                  className={cmwError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerMinWidth || containerWidth);
                    setContainerMinWidth(next);
                    if (!isCssSize(next)) { setCmwError(true); toast.error('Min width inválido'); return; }
                    setCmwError(false);
                    applyContainerSizingLive({ nextMinWidth: next });
                  }}
                />
              </div>
                <div>
                  <Label htmlFor="cf-container-padding-left" className="text-xs text-muted-foreground">Padding left</Label>
                  <Input
                    id="cf-container-padding-left"
                      value={containerPaddingLeft}
                      placeholder="16px or 1rem"
                      className={cpadLError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerPaddingLeft || '16px');
                        setContainerPaddingLeft(next);
                        if (!isCssSize(next)) { setCpadLError(true); toast.error('Padding inválido'); return; }
                        setCpadLError(false);
                        applyContainerSizingLive({ nextPaddingLeft: next });
                      }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-container-padding-top" className="text-xs text-muted-foreground">Padding top</Label>
                  <Input
                    id="cf-container-padding-top"
                      value={containerPaddingTop}
                      placeholder="16px or 1rem"
                      className={cpadTError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerPaddingTop || '16px');
                        setContainerPaddingTop(next);
                        if (!isCssSize(next)) { setCpadTError(true); toast.error('Padding inválido'); return; }
                        setCpadTError(false);
                        applyContainerSizingLive({ nextPaddingTop: next });
                      }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-container-padding-bottom" className="text-xs text-muted-foreground">Padding bottom</Label>
                  <Input
                    id="cf-container-padding-bottom"
                      value={containerPaddingBottom}
                      placeholder="16px or 1rem"
                      className={cpadBError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerPaddingBottom || containerPaddingTop || '16px');
                        setContainerPaddingBottom(next);
                        if (!isCssSize(next)) { setCpadBError(true); toast.error('Padding inválido'); return; }
                        setCpadBError(false);
                        applyContainerSizingLive({ nextPaddingBottom: next });
                      }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-container-padding-right" className="text-xs text-muted-foreground">Padding right</Label>
                  <Input
                    id="cf-container-padding-right"
                      value={containerPaddingRight}
                      placeholder="16px or 1rem"
                      className={cpadRError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerPaddingRight || containerPaddingLeft || '16px');
                        setContainerPaddingRight(next);
                        if (!isCssSize(next)) { setCpadRError(true); toast.error('Padding inválido'); return; }
                        setCpadRError(false);
                        applyContainerSizingLive({ nextPaddingRight: next });
                      }}
                  />
                </div>
              <div>
                <Label htmlFor="cf-container-height" className="text-xs text-muted-foreground">Height</Label>
                <Input
                  id="cf-container-height"
                  value={containerHeight}
                  placeholder="auto or 400px"
                  className={chError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerHeight);
                    setContainerHeight(next);
                    if (!isCssSize(next)) { setChError(true); toast.error('Height inválido'); return; }
                    setChError(false);
                    applyContainerSizingLive({ nextHeight: next });
                  }}
                />
              </div>
              <div>
                <Label htmlFor="cf-container-min-height" className="text-xs text-muted-foreground">Min height</Label>
                <Input
                  id="cf-container-min-height"
                  value={containerMinHeight}
                  placeholder="0px or 200px"
                  className={cmhError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerMinHeight || containerHeight);
                    setContainerMinHeight(next);
                    if (!isCssSize(next)) { setCmhError(true); toast.error('Min height inválido'); return; }
                    setCmhError(false);
                    applyContainerSizingLive({ nextMinHeight: next });
                  }}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="cf-container-max-width" className="text-xs text-muted-foreground">Max width</Label>
                <Input
                  id="cf-container-max-width"
                  value={containerMaxWidth}
                  placeholder="none or 1200px"
                  className={cmaxwError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerMaxWidth || containerWidth);
                    setContainerMaxWidth(next);
                    if (!isCssSize(next)) { setCmaxwError(true); toast.error('Max width inválido'); return; }
                    setCmaxwError(false);
                    applyContainerSizingLive({ nextMaxWidth: next });
                  }}
                />
              </div>
              <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="cf-container-border-width" className="text-xs text-muted-foreground">Border width</Label>
                  <Input
                    id="cf-container-border-width"
                    value={containerBorderWidth}
                    placeholder="0px or 1px"
                    className={cbwError ? 'border-destructive' : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = normalizeSizeWithFallback(raw, containerBorderWidth || '1px');
                      setContainerBorderWidth(next);
                      if (!isCssSize(next)) { setCbwError(true); toast.error('Border width inválido'); return; }
                      setCbwError(false);
                      applyContainerSizingLive({ nextBorderWidth: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-container-border-color" className="text-xs text-muted-foreground">Border color</Label>
                  {renderBrandPaletteSwatches(
                    'container-border-color',
                    (color) => {
                      setContainerBorderColor(color);
                      applyContainerSizingLive({ nextBorderColor: color });
                    },
                    (color) => `Apply ${color} as border color`,
                  )}
                  <Input
                    id="cf-container-border-color"
                    type="color"
                    value={containerBorderColor}
                    onChange={(e) => {
                      const next = e.target.value;
                      setContainerBorderColor(next);
                      applyContainerSizingLive({ nextBorderColor: next });
                    }}
                  />
                </div>
              </div>
              <div className="col-span-2">
                <FieldLabel htmlFor="cf-container-border-radius" hint="Applies to the selected container wrapper. This does not affect inner element radius unless they inherit it.">
                  Container radius
                </FieldLabel>
                <Input
                  id="cf-container-border-radius"
                  value={containerBorderRadius}
                  placeholder="0px or 8px"
                  className={cbrError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerBorderRadius || '0px');
                    setContainerBorderRadius(next);
                    if (!isCssSize(next)) { setCbrError(true); toast.error('Border radius inválido'); return; }
                    setCbrError(false);
                    applyContainerSizingLive({ nextBorderRadius: next });
                  }}
                />
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="cf-container-align" hint="Sets the cross-axis alignment of child items when this container is a flex container. e.g. stretch, center, flex-start.">
                    Align items
                  </FieldLabel>
                  <select
                    id="cf-container-align"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={containerAlignItems}
                    onChange={(e) => {
                      const next = e.target.value;
                      setContainerAlignItems(next);
                      applyContainerSizingLive({ nextAlignItems: next });
                    }}
                  >
                    <option value="">(none)</option>
                    <option value="stretch">stretch</option>
                    <option value="flex-start">flex-start</option>
                    <option value="center">center</option>
                    <option value="flex-end">flex-end</option>
                    <option value="baseline">baseline</option>
                  </select>
                </div>
                <div>
                  <FieldLabel htmlFor="cf-container-justify" hint="Controls distribution of child items along the main axis when this container is a flex container. e.g. space-between, center, flex-start.">
                    Justify content
                  </FieldLabel>
                  <select
                    id="cf-container-justify"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={containerJustifyContent}
                    onChange={(e) => {
                      const next = e.target.value;
                      setContainerJustifyContent(next);
                      applyContainerSizingLive({ nextJustifyContent: next });
                    }}
                  >
                    <option value="">(none)</option>
                    <option value="flex-start">flex-start</option>
                    <option value="center">center</option>
                    <option value="flex-end">flex-end</option>
                    <option value="space-between">space-between</option>
                    <option value="space-around">space-around</option>
                    <option value="space-evenly">space-evenly</option>
                  </select>
                </div>
              </div>
              <div className="col-span-2 mt-2">
                <FieldLabel htmlFor="cf-container-display" hint="Sets the layout method for this container (block, flex, grid).">
                  Display
                </FieldLabel>
                <select
                  id="cf-container-display"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1"
                  value={containerDisplay}
                  onChange={(e) => {
                    const next = e.target.value;
                    setContainerDisplay(next);
                    applyContainerSizingLive({ nextDisplay: next });
                  }}
                >
                  <option value="">(none)</option>
                  <option value="block">block</option>
                  <option value="inline-block">inline-block</option>
                  <option value="flex">flex</option>
                  <option value="inline-flex">inline-flex</option>
                  <option value="grid">grid</option>
                  <option value="inline-grid">inline-grid</option>
                </select>
              </div>

              {/* Flex controls (only when display includes 'flex') */}
              {(containerDisplay || '').includes('flex') && (
                <div className="col-span-2 grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <FieldLabel htmlFor="cf-container-flex-direction" hint="Direction when display is flex.">
                      Flex direction
                    </FieldLabel>
                    <select
                      id="cf-container-flex-direction"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1"
                      value={containerFlexDirection}
                      onChange={(e) => {
                        const next = e.target.value;
                        setContainerFlexDirection(next);
                        applyContainerSizingLive({ nextFlexDirection: next });
                      }}
                    >
                      <option value="">(none)</option>
                      <option value="row">row</option>
                      <option value="row-reverse">row-reverse</option>
                      <option value="column">column</option>
                      <option value="column-reverse">column-reverse</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="cf-container-flex-wrap" hint="Wrap behavior for flex containers.">
                      Flex wrap
                    </FieldLabel>
                    <select
                      id="cf-container-flex-wrap"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1"
                      value={containerFlexWrap}
                      onChange={(e) => {
                        const next = e.target.value;
                        setContainerFlexWrap(next);
                        applyContainerSizingLive({ nextFlexWrap: next });
                      }}
                    >
                      <option value="">(none)</option>
                      <option value="nowrap">nowrap</option>
                      <option value="wrap">wrap</option>
                      <option value="wrap-reverse">wrap-reverse</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="col-span-2 mt-2">
                <FieldLabel htmlFor="cf-container-gap" hint="Gap between items (flex/grid). Example: 8px or 1rem.">
                  Gap
                </FieldLabel>
                <Input id="cf-container-gap" value={containerGap} placeholder="8px or 1rem" className={cgapError ? 'border-destructive' : ''} onChange={(e) => {
                  const raw = e.target.value;
                  const next = normalizeSizeWithFallback(raw, containerGap || '8px');
                  setContainerGap(next);
                  if (!isGap(next)) { setCgapError(true); toast.error('Gap inválido. Use valores como 8px, 1rem ou vazio'); return; }
                  setCgapError(false);
                  applyContainerSizingLive({ nextGap: next });
                }} />
              </div>

              {/* Grid controls (only when display includes 'grid') */}
              {(containerDisplay || '').includes('grid') && (
                <>
                  <div className="col-span-2 grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <FieldLabel htmlFor="cf-container-grid-cols" hint="Template columns when display is grid. Example: repeat(3, 1fr) or 200px 1fr.">
                        Grid template columns
                      </FieldLabel>
                      <Input id="cf-container-grid-cols" value={containerGridTemplateColumns} placeholder="repeat(3, 1fr)" className={cgridColsError ? 'border-destructive' : ''} onChange={(e) => {
                        const raw = e.target.value;
                        const next = raw.trim();
                        setContainerGridTemplateColumns(next);
                        if (!isGridTemplate(next)) { setCgridColsError(true); toast.error('grid-template-columns inválido'); return; }
                        setCgridColsError(false);
                        applyContainerSizingLive({ nextGridTemplateColumns: next });
                      }} />
                    </div>
                    <div>
                      <FieldLabel htmlFor="cf-container-grid-auto-flow" hint="Grid auto flow (row/column/dense)">
                        Grid auto flow
                      </FieldLabel>
                      <select id="cf-container-grid-auto-flow" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm mt-1" value={containerGridAutoFlow} onChange={(e) => { const next = e.target.value; setContainerGridAutoFlow(next); applyContainerSizingLive({ nextGridAutoFlow: next }); }}>
                        <option value="">(none)</option>
                        <option value="row">row</option>
                        <option value="column">column</option>
                        <option value="row dense">row dense</option>
                        <option value="column dense">column dense</option>
                      </select>
                    </div>
                  </div>

                  <div className="col-span-2 mt-2">
                    <FieldLabel htmlFor="cf-container-grid-gap" hint="Gap between grid items.">
                      Grid gap
                    </FieldLabel>
                    <Input id="cf-container-grid-gap" value={containerGridGap} placeholder="8px or 1rem" className={cgridGapError ? 'border-destructive' : ''} onChange={(e) => {
                      const raw = e.target.value;
                      const next = normalizeSizeWithFallback(raw, containerGridGap || containerGap || '8px');
                      setContainerGridGap(next);
                      if (!isGap(next)) { setCgridGapError(true); toast.error('Grid gap inválido.'); return; }
                      setCgridGapError(false);
                      applyContainerSizingLive({ nextGridGap: next });
                    }} />
                  </div>
                </>
              )}
                <div>
                  <FieldLabel htmlFor="cf-container-margin-top" hint="Sets the top margin of the container wrapper.">
                    Margin top
                  </FieldLabel>
                  <Input
                    id="cf-container-margin-top"
                    value={containerMarginTop}
                    placeholder="0px"
                    className={cmTError ? 'border-destructive' : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = normalizeSizeWithFallback(raw, containerMarginTop || '0px');
                      setContainerMarginTop(next);
                      if (!isCssSize(next)) { setCmTError(true); toast.error('Margin top inválido'); return; }
                      setCmTError(false);
                      applyContainerSizingLive({ nextMarginTop: next });
                    }}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="cf-container-margin-bottom" hint="Sets the bottom margin of the container wrapper.">
                    Margin bottom
                  </FieldLabel>
                  <Input
                    id="cf-container-margin-bottom"
                    value={containerMarginBottom}
                    placeholder="0px"
                    className={cmBError ? 'border-destructive' : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = normalizeSizeWithFallback(raw, containerMarginBottom || '0px');
                      setContainerMarginBottom(next);
                      if (!isCssSize(next)) { setCmBError(true); toast.error('Margin bottom inválido'); return; }
                      setCmBError(false);
                      applyContainerSizingLive({ nextMarginBottom: next });
                    }}
                  />
                </div>
                <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <div>
                    <FieldLabel htmlFor="cf-container-margin-left" hint="Sets the left margin of the container. Use 'auto' to horizontally center the container when width is constrained.">
                      Margin left
                    </FieldLabel>
                    <Input
                      id="cf-container-margin-left"
                      value={containerMarginLeft}
                      placeholder="0px or auto"
                      className={cmLError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerMarginLeft || '0px');
                        setContainerMarginLeft(next);
                        if (!isCssSize(next)) { setCmLError(true); toast.error('Margin left inválido'); return; }
                        setCmLError(false);
                        applyContainerSizingLive({ nextMarginLeft: next });
                      }}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="cf-container-margin-right" hint="Sets the right margin of the container. Use 'auto' to horizontally center the container when width is constrained.">
                      Margin right
                    </FieldLabel>
                    <Input
                      id="cf-container-margin-right"
                      value={containerMarginRight}
                      placeholder="0px or auto"
                      className={cmRError ? 'border-destructive' : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = normalizeSizeWithFallback(raw, containerMarginRight || containerMarginLeft || '0px');
                        setContainerMarginRight(next);
                        if (!isCssSize(next)) { setCmRError(true); toast.error('Margin right inválido'); return; }
                        setCmRError(false);
                        applyContainerSizingLive({ nextMarginRight: next });
                      }}
                    />
                  </div>
                </div>
              <div className="col-span-2 mt-2">
                <Button className="w-full whitespace-nowrap text-sm" size="sm" onClick={() => {
                  setContainerMarginLeft('auto');
                  setContainerMarginRight('auto');
                  setCmLError(false);
                  setCmRError(false);
                  applyContainerSizingLive({ nextMarginLeft: 'auto', nextMarginRight: 'auto' });
                }}>Center container horizontally</Button>
              </div>
              <div className="col-span-2 mt-2">
                <Button className="w-full whitespace-nowrap text-sm" size="sm" onClick={() => {
                  setContainerAlignItems('center');
                  setContainerJustifyContent('center');
                  applyContainerSizingLive({ nextAlignItems: 'center', nextJustifyContent: 'center' });
                }}>Center children (align & justify)</Button>
              </div>
              <div className="col-span-2">
                <Label htmlFor="cf-container-max-height" className="text-xs text-muted-foreground">Max height</Label>
                <Input
                  id="cf-container-max-height"
                  value={containerMaxHeight}
                  placeholder="none or 800px"
                  className={cmaxhError ? 'border-destructive' : ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = normalizeSizeWithFallback(raw, containerMaxHeight || containerHeight || '800px');
                    setContainerMaxHeight(next);
                    if (!isCssSize(next)) { setCmaxhError(true); toast.error('Max height inválido'); return; }
                    setCmaxhError(false);
                    applyContainerSizingLive({ nextMaxHeight: next });
                  }}
                />
              </div>
            </div>
          </div>

          {selected.sectionPath && (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <Label>Section Spacing & Style</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={duplicateSection}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </Button>
                <Button size="sm" variant="outline" onClick={moveSectionUp}>
                  <ArrowUp className="mr-2 h-4 w-4" /> Up
                </Button>
                <Button size="sm" variant="outline" onClick={moveSectionDown}>
                  <ArrowDown className="mr-2 h-4 w-4" /> Down
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="cf-section-pt" className="text-xs text-muted-foreground">Padding top (px)</Label>
                  <Input
                    id="cf-section-pt"
                    type="number"
                    min={0}
                    max={300}
                    value={paddingTop}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setPaddingTop(next);
                      applySectionSpacingLive({ nextPaddingTop: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-pb" className="text-xs text-muted-foreground">Padding bottom (px)</Label>
                  <Input
                    id="cf-section-pb"
                    type="number"
                    min={0}
                    max={300}
                    value={paddingBottom}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setPaddingBottom(next);
                      applySectionSpacingLive({ nextPaddingBottom: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-mt" className="text-xs text-muted-foreground">Margin top (px)</Label>
                  <Input
                    id="cf-section-mt"
                    type="number"
                    min={0}
                    max={300}
                    value={marginTop}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setMarginTop(next);
                      applySectionSpacingLive({ nextMarginTop: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-mb" className="text-xs text-muted-foreground">Margin bottom (px)</Label>
                  <Input
                    id="cf-section-mb"
                    type="number"
                    min={0}
                    max={300}
                    value={marginBottom}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setMarginBottom(next);
                      applySectionSpacingLive({ nextMarginBottom: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-pl" className="text-xs text-muted-foreground">Padding left (px)</Label>
                  <Input
                    id="cf-section-pl"
                    type="number"
                    min={0}
                    max={300}
                    value={paddingLeft}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setPaddingLeft(next);
                      applySectionSpacingLive({ nextPaddingLeft: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-pr" className="text-xs text-muted-foreground">Padding right (px)</Label>
                  <Input
                    id="cf-section-pr"
                    type="number"
                    min={0}
                    max={300}
                    value={paddingRight}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setPaddingRight(next);
                      applySectionSpacingLive({ nextPaddingRight: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-ml" className="text-xs text-muted-foreground">Margin left (px)</Label>
                  <Input
                    id="cf-section-ml"
                    type="number"
                    min={0}
                    max={300}
                    value={marginLeft}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setMarginLeft(next);
                      applySectionSpacingLive({ nextMarginLeft: next });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="cf-section-mr" className="text-xs text-muted-foreground">Margin right (px)</Label>
                  <Input
                    id="cf-section-mr"
                    type="number"
                    min={0}
                    max={300}
                    value={marginRight}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0);
                      setMarginRight(next);
                      applySectionSpacingLive({ nextMarginRight: next });
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="cf-section-bg-mode" className="text-xs text-muted-foreground">Background mode</Label>
                  <select
                    id="cf-section-bg-mode"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={sectionBgMode}
                    onChange={(e) => {
                      const next = e.target.value as 'solid' | 'gradient' | 'image';
                      setSectionBgMode(next);
                      if (next !== 'image') setShowBgAssetManager(false);
                      applySectionBackgroundLive({ nextMode: next });
                    }}
                  >
                    <option value="solid">Solid color</option>
                    <option value="gradient">Gradient</option>
                    <option value="image">Background image</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cf-section-opacity" className="text-xs text-muted-foreground">Transparency ({bgOpacity}%)</Label>
                  <Input
                    id="cf-section-opacity"
                    type="range"
                    min={0}
                    max={100}
                    value={bgOpacity}
                    onChange={(e) => {
                      const next = Number(e.target.value || 100);
                      setBgOpacity(next);
                      applySectionBackgroundLive({ nextBgOpacity: next });
                    }}
                  />
                </div>
              </div>
              {sectionBgMode === 'gradient' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="cf-grad-color-1" className="text-xs text-muted-foreground">Gradient color 1</Label>
                    {renderBrandPaletteSwatches(
                      'section-grad-1',
                      (color) => {
                        setGradientColor1(color);
                        applySectionBackgroundLive({ nextGrad1: color });
                      },
                      (color) => `Apply ${color} as gradient color 1`,
                    )}
                    <Input
                      id="cf-grad-color-1"
                      type="color"
                      value={gradientColor1}
                      onChange={(e) => {
                        const next = e.target.value;
                        setGradientColor1(next);
                        applySectionBackgroundLive({ nextGrad1: next });
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cf-grad-color-2" className="text-xs text-muted-foreground">Gradient color 2</Label>
                    {renderBrandPaletteSwatches(
                      'section-grad-2',
                      (color) => {
                        setGradientColor2(color);
                        applySectionBackgroundLive({ nextGrad2: color });
                      },
                      (color) => `Apply ${color} as gradient color 2`,
                    )}
                    <Input
                      id="cf-grad-color-2"
                      type="color"
                      value={gradientColor2}
                      onChange={(e) => {
                        const next = e.target.value;
                        setGradientColor2(next);
                        applySectionBackgroundLive({ nextGrad2: next });
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="cf-grad-angle" className="text-xs text-muted-foreground">Gradient angle ({gradientAngle}deg)</Label>
                    <Input
                      id="cf-grad-angle"
                      type="range"
                      min={0}
                      max={360}
                      value={gradientAngle}
                      onChange={(e) => {
                        const next = Number(e.target.value || 135);
                        setGradientAngle(next);
                        applySectionBackgroundLive({ nextAngle: next });
                      }}
                    />
                  </div>
                </div>
              ) : sectionBgMode === 'image' ? (
                <div className="space-y-2">
                  <Label htmlFor="cf-section-bg-image-url" className="text-xs text-muted-foreground">Background image URL</Label>
                  <Input
                    id="cf-section-bg-image-url"
                    value={bgImageUrl}
                    placeholder="/assets/your-image.jpg"
                    onChange={(e) => {
                      const next = e.target.value;
                      setBgImageUrl(next);
                      applySectionBackgroundLive({ nextBgImageUrl: next });
                    }}
                  />
                  <Button className="w-full" size="sm" variant="secondary" onClick={openBgAssetManager}>
                    <FolderOpen className="mr-2 h-4 w-4" /> Open Assets Folder
                  </Button>

                  <div className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-3">
                    <div>
                      <Label htmlFor="cf-section-bg-image-size" className="text-xs text-muted-foreground">Fit</Label>
                      <select
                        id="cf-section-bg-image-size"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={bgImageSize}
                        onChange={(e) => {
                          const next = e.target.value;
                          setBgImageSize(next);
                          applySectionBackgroundLive({ nextBgImageSize: next });
                        }}
                      >
                        <option value="cover">cover</option>
                        <option value="contain">contain</option>
                        <option value="auto">auto</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="cf-section-bg-image-position" className="text-xs text-muted-foreground">Object position</Label>
                      <select
                        id="cf-section-bg-image-position"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={bgImagePosition}
                        onChange={(e) => {
                          const next = e.target.value;
                          setBgImagePosition(next);
                          applySectionBackgroundLive({ nextBgImagePosition: next });
                        }}
                      >
                        <option value="center">center</option>
                        <option value="top">top</option>
                        <option value="bottom">bottom</option>
                        <option value="left">left</option>
                        <option value="right">right</option>
                        <option value="top left">top left</option>
                        <option value="top right">top right</option>
                        <option value="bottom left">bottom left</option>
                        <option value="bottom right">bottom right</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label htmlFor="cf-section-bg-image-repeat" className="text-xs text-muted-foreground">Repeat</Label>
                      <select
                        id="cf-section-bg-image-repeat"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={bgImageRepeat}
                        onChange={(e) => {
                          const next = e.target.value;
                          setBgImageRepeat(next);
                          applySectionBackgroundLive({ nextBgImageRepeat: next });
                        }}
                      >
                        <option value="no-repeat">no-repeat</option>
                        <option value="repeat">repeat</option>
                        <option value="repeat-x">repeat-x</option>
                        <option value="repeat-y">repeat-y</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-md border border-border/60 p-3">
                    <Label htmlFor="cf-section-bg-overlay-mode" className="text-xs text-muted-foreground">Image Overlay</Label>
                    <select
                      id="cf-section-bg-overlay-mode"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={overlayMode}
                      onChange={(e) => {
                        const next = e.target.value as OverlayMode;
                        setOverlayMode(next);
                        applySectionBackgroundLive({ nextOverlayMode: next });
                      }}
                    >
                      <option value="none">None</option>
                      <option value="color">Color Overlay</option>
                      <option value="gradient">Gradient Overlay</option>
                      <option value="dark">Dark Overlay</option>
                      <option value="mask">Image Mask / Layer</option>
                    </select>

                    {(overlayMode === 'color' || overlayMode === 'mask') && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="cf-section-bg-overlay-color" className="text-xs text-muted-foreground">Overlay color</Label>
                          {renderBrandPaletteSwatches(
                            'section-overlay-color',
                            (color) => {
                              setOverlayColor(color);
                              applySectionBackgroundLive({ nextOverlayColor: color });
                            },
                            (color) => `Apply ${color} as overlay color`,
                          )}
                          <Input
                            id="cf-section-bg-overlay-color"
                            type="color"
                            value={overlayColor}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayColor(next);
                              applySectionBackgroundLive({ nextOverlayColor: next });
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="cf-section-bg-overlay-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                          <Input
                            id="cf-section-bg-overlay-opacity"
                            type="range"
                            min={0}
                            max={100}
                            value={overlayOpacity}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              setOverlayOpacity(next);
                              applySectionBackgroundLive({ nextOverlayOpacity: next });
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {overlayMode === 'gradient' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor="cf-section-bg-overlay-grad-1" className="text-xs text-muted-foreground">Gradient color 1</Label>
                          {renderBrandPaletteSwatches(
                            'section-overlay-grad-1',
                            (color) => {
                              setOverlayGrad1(color);
                              applySectionBackgroundLive({ nextOverlayGrad1: color });
                            },
                            (color) => `Apply ${color} as overlay gradient color 1`,
                          )}
                          <Input
                            id="cf-section-bg-overlay-grad-1"
                            type="color"
                            value={overlayGrad1}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayGrad1(next);
                              applySectionBackgroundLive({ nextOverlayGrad1: next });
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="cf-section-bg-overlay-grad-2" className="text-xs text-muted-foreground">Gradient color 2</Label>
                          {renderBrandPaletteSwatches(
                            'section-overlay-grad-2',
                            (color) => {
                              setOverlayGrad2(color);
                              applySectionBackgroundLive({ nextOverlayGrad2: color });
                            },
                            (color) => `Apply ${color} as overlay gradient color 2`,
                          )}
                          <Input
                            id="cf-section-bg-overlay-grad-2"
                            type="color"
                            value={overlayGrad2}
                            onChange={(e) => {
                              const next = e.target.value;
                              setOverlayGrad2(next);
                              applySectionBackgroundLive({ nextOverlayGrad2: next });
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label htmlFor="cf-section-bg-overlay-angle" className="text-xs text-muted-foreground">Gradient angle ({overlayAngle}deg)</Label>
                          <Input
                            id="cf-section-bg-overlay-angle"
                            type="range"
                            min={0}
                            max={360}
                            value={overlayAngle}
                            onChange={(e) => {
                              const next = Number(e.target.value || 180);
                              setOverlayAngle(next);
                              applySectionBackgroundLive({ nextOverlayAngle: next });
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label htmlFor="cf-section-bg-overlay-grad-opacity" className="text-xs text-muted-foreground">Overlay opacity ({overlayOpacity}%)</Label>
                          <Input
                            id="cf-section-bg-overlay-grad-opacity"
                            type="range"
                            min={0}
                            max={100}
                            value={overlayOpacity}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              setOverlayOpacity(next);
                              applySectionBackgroundLive({ nextOverlayOpacity: next });
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {overlayMode === 'dark' && (
                      <div>
                        <Label htmlFor="cf-section-bg-overlay-dark" className="text-xs text-muted-foreground">Dark strength ({darkOverlayStrength}%)</Label>
                        <Input
                          id="cf-section-bg-overlay-dark"
                          type="range"
                          min={0}
                          max={100}
                          value={darkOverlayStrength}
                          onChange={(e) => {
                            const next = Number(e.target.value || 0);
                            setDarkOverlayStrength(next);
                            applySectionBackgroundLive({ nextDarkOverlayStrength: next });
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="cf-solid-color" className="text-xs text-muted-foreground">Solid color</Label>
                  {renderBrandPaletteSwatches(
                    'section-solid-color',
                    (color) => {
                      setBgColor(color);
                      applySectionBackgroundLive({ nextBgColor: color });
                    },
                    (color) => `Apply ${color} as solid background color`,
                  )}
                  <Input
                    id="cf-solid-color"
                    type="color"
                    value={bgColor}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBgColor(next);
                      applySectionBackgroundLive({ nextBgColor: next });
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {selected.tag === 'a' && (
            <div className="space-y-2">
              <Label htmlFor="cf-link-href">Link URL</Label>
              <Input
                id="cf-link-href"
                value={hrefValue}
                onChange={(e) => {
                  const next = e.target.value;
                  setHrefValue(next);
                  applyAnchorLinkLive({ nextHref: next });
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="cf-link-target" className="text-xs text-muted-foreground">Target</Label>
                  <select
                    id="cf-link-target"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={linkTarget}
                    onChange={(e) => {
                      const next = e.target.value;
                      setLinkTarget(next);
                      applyAnchorLinkLive({ nextTarget: next });
                    }}
                  >
                    <option value="_self">Same tab (_self)</option>
                    <option value="_blank">New tab (_blank)</option>
                    <option value="_parent">Parent (_parent)</option>
                    <option value="_top">Top (_top)</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="cf-link-rel" className="text-xs text-muted-foreground">Rel</Label>
                  <Input
                    id="cf-link-rel"
                    value={linkRel}
                    placeholder="noopener noreferrer"
                    onChange={(e) => {
                      const next = e.target.value;
                      setLinkRel(next);
                      applyAnchorLinkLive({ nextRel: next });
                    }}
                  />
                  
                </div>
              </div>
              <div className="mt-2">
                <Label htmlFor="cf-file-download" className="text-xs text-muted-foreground">File Download Path (optional)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="cf-file-download"
                    className="flex-1"
                    value={fileDownloadPath}
                    placeholder="/files/your-file.pdf"
                    onChange={(e) => setFileDownloadPath(e.target.value)}
                  />
                  <Button size="sm" onClick={() => {
                    const next = (fileDownloadPath || '').trim();
                    if (!next) {
                      applyAnchorLinkLive({ nextDownload: '' });
                      toast.success('Removed download attribute');
                      return;
                    }
                    setHrefValue(next);
                    applyAnchorLinkLive({ nextHref: next, nextDownload: next });
                    toast.success('Download path applied');
                  }}>Set</Button>
                </div>
              </div>
              <div>
                <Button size="sm" variant="outline" className="w-full" onClick={openFilesFolder}>
                  <FolderOpen className="mr-2 h-4 w-4" /> Open Files Folder
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            {isSelectedSection() ? (
              <Button className="w-full" size="sm" variant="destructive" onClick={removeSection} disabled={!selected?.sectionPath}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove Section
              </Button>
            ) : (
              <Button className="w-full" size="sm" variant="destructive" onClick={removeElement} disabled={!selected?.path}>
                <Trash2 className="mr-2 h-4 w-4" /> Remove Element
              </Button>
            )}
          </div>


          </div>
        )
      )}
    </div>
  );

  // Snapshots popover for header
  const snapshotsContent = (
    <div className="space-y-2 min-w-[260px] max-w-[340px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Snapshots</p>
        <Button size="sm" variant="outline" onClick={saveSnapshot}>Save Snapshot</Button>
      </div>
      {snapshots.length === 0 ? (
        <p className="text-xs text-muted-foreground">No snapshots yet.</p>
      ) : (
        <div className="max-h-40 space-y-2 overflow-auto">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="rounded border border-border/60 p-2">
              <p className="truncate text-xs font-medium">{snapshot.label}</p>
              <p className="text-[11px] text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString()}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => restoreSnapshot(snapshot)}>
                  Restore
                </Button>
                <Button size="sm" variant="destructive" onClick={() => deleteSnapshot(snapshot.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (layout === 'overlay') {
    return (
      <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_56px] gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-lg">
          {iframeEl}
        </div>

        <aside className="h-full overflow-y-auto rounded-xl border border-border bg-gradient-to-b from-background via-background to-muted/40 shadow-xl">
          <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-3 py-3 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setPanelOpen(p => !p)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
                title={panelOpen ? 'Hide editor panel' : 'Show editor panel'}
              >
                {panelOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                )}
              </button>
              {panelOpen && <h3 className="text-sm font-semibold tracking-wide">Visual Editor</h3>}
              {panelOpen ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={undo} disabled={!canUndo}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={redo} disabled={!canRedo}>
                    <Redo2 className="h-4 w-4" />
                  </Button>
                  <Badge variant={saving ? 'default' : 'secondary'}>{saving ? 'Saving...' : 'Saved'}</Badge>
                </div>
              ) : <div />}
            </div>
          </div>
          {panelOpen ? <div className="space-y-3 p-4">{panelContent}</div> : <div className="p-3 text-center text-xs text-muted-foreground">Edit</div>}
            </aside>
            {showFilesFolder && (
              <div style={{position: 'fixed', right: 18, top: 72, zIndex: 9999}}>
                <div className="rounded bg-yellow-300 text-black px-3 py-1 text-xs font-semibold shadow">FILES PANEL OPEN (debug)</div>
              </div>
            )}

            {/* Global files modal (overlay) - ensure visibility even when sidebar has selection */}
            {showFilesFolder && (
              <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/40">
                <div className="bg-background rounded-lg shadow-lg p-4 w-full max-w-2xl border border-border" style={{ outline: '3px solid magenta' }}>
                      <div className="mb-3 rounded-t px-3 py-2 bg-primary text-white flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Project Files Folder</h3>
                        <Button size="sm" variant="ghost" onClick={() => setShowFilesFolder(false)}>Close</Button>
                      </div>

                      <div className="px-3 py-2">
                        <p className="text-xs text-muted-foreground mb-3">Upload, remove, and copy paths from this project's files folder.</p>
                      </div>

                  <div className="mb-3">
                    <input ref={fileFolderInputRef} type="file" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
                    <Button size="sm" variant="outline" onClick={() => fileFolderInputRef.current?.click()} disabled={filesUploading}><Upload className="mr-2 h-4 w-4" />{filesUploading ? 'Uploading...' : 'Upload files to files folder'}</Button>
                  </div>

                  <div className="max-h-[50vh] overflow-auto space-y-2">
                    {filesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading files...</p>
                    ) : files.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-sm text-muted-foreground">No files in files folder yet.</p>
                        <p className="text-xs text-muted-foreground mt-2">Upload files above — they will appear here and you can copy their URLs.</p>
                      </div>
                    ) : files.map((f) => (
                      <div key={f.name} className="rounded border border-border/60 p-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="truncate text-xs font-medium">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground">{Math.round((f.size || 0) / 1024)} KB</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => {
                              const rel = toRelativeFilePath(f.url || '');
                              navigator.clipboard.writeText(rel).then(() => toast.success('File path copied to clipboard (relative)')).catch(() => toast.error('Could not copy path'));
                            }}><Copy className="mr-2 h-4 w-4" />Copy</Button>
                            <Button size="sm" variant="ghost" onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}>Open</Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteFile(f.name)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
    );
  }

  // Snapshots popover in header
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-[500px] overflow-hidden rounded-xl border border-border bg-white shadow-lg" style={{ minHeight: '70vh', position: 'relative' }}>
        {/* Header with Open Raw Site, Snapshots, Undo/Redo, Save Changes */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-background/95 sticky top-0 z-40">
          {/* Open Raw Site */}
          <Button size="sm" variant="outline" onClick={() => window.open(livePreviewUrl, '_blank')}>Open Raw Site</Button>

          {/* Snapshots dropdown (popover) */}
          <div className="relative group">
            <Button size="sm" variant="outline" className="snapshots-dropdown-btn">Snapshots</Button>
            <div className="absolute left-0 mt-2 hidden group-hover:block bg-background border border-border/60 rounded shadow-lg z-50 min-w-[260px]">
              {snapshotsContent}
            </div>
          </div>

          {/* Undo/Redo */}
          <Button size="sm" variant="ghost" className="h-8 px-2 ml-2" onClick={undo} disabled={!canUndo}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={redo} disabled={!canRedo}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Badge variant={saving ? 'default' : 'secondary'} className="ml-2">{saving ? 'Saving...' : 'Saved'}</Badge>

          {/* Save Changes - always last, pink, prominent */}
          <Button
            size="sm"
            className="ml-auto bg-pink-600 hover:bg-pink-700 text-white font-bold px-5 py-2 rounded shadow transition"
            onClick={() => onChange(html)}
          >
            Save Changes
          </Button>
        </div>
        {iframeEl}
        {/* Botões de ordem para sessão selecionada */}
        {selected?.sectionPath && (
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 50, display: 'flex', gap: 8 }}>
            <Button size="icon" variant="ghost" onClick={() => moveSection(selected.sectionPath!, 'up')} title="Move up"><GripVertical style={{ transform: 'rotate(-90deg)' }} /></Button>
            <Button size="icon" variant="ghost" onClick={() => moveSection(selected.sectionPath!, 'down')} title="Move down"><GripVertical style={{ transform: 'rotate(90deg)' }} /></Button>
          </div>
        )}
      </div>

      <aside className="rounded-xl border border-border bg-background/95 p-4 overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Visual Editor</h3>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={undo} disabled={!canUndo}>
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={redo} disabled={!canRedo}>
              <Redo2 className="h-4 w-4" />
            </Button>
            <Badge variant={saving ? 'default' : 'secondary'}>{saving ? 'Saving...' : 'Saved'}</Badge>
          </div>
        </div>
        <div className="space-y-3">
          {panelContent}
        </div>
      </aside>

      {/* Global files modal (overlay) - ensure visibility even when sidebar has selection */}
      {showFilesFolder && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-lg p-4 w-full max-w-2xl border border-border" style={{ outline: '3px solid magenta' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Project Files Folder</h3>
              <Button size="sm" variant="ghost" onClick={() => setShowFilesFolder(false)}>Close</Button>
            </div>

            <p className="text-xs text-muted-foreground mb-3">Upload, remove, and copy paths from this project's files folder.</p>

            <div className="mb-3">
              <input ref={fileFolderInputRef} type="file" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
              <Button size="sm" variant="outline" onClick={() => fileFolderInputRef.current?.click()} disabled={filesUploading}><Upload className="mr-2 h-4 w-4" />{filesUploading ? 'Uploading...' : 'Upload files to files folder'}</Button>
            </div>

                      <div className="max-h-[50vh] overflow-auto space-y-2">
                        {filesLoading ? (
                          <p className="text-xs text-muted-foreground">Loading files...</p>
                        ) : files.length === 0 ? (
                          <div className="text-center py-6">
                            <p className="text-sm text-muted-foreground">No files in files folder yet.</p>
                            <p className="text-xs text-muted-foreground mt-2">Upload files above — they will appear here and you can copy their URLs.</p>
                          </div>
                        ) : files.map((f) => (
                          <div key={f.name} className="rounded border border-border/60 p-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="truncate text-xs font-medium">{f.name}</p>
                                <p className="text-[11px] text-muted-foreground">{Math.round((f.size || 0) / 1024)} KB</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => {
                                  const rel = toRelativeFilePath(f.url || '');
                                  navigator.clipboard.writeText(rel).then(() => toast.success('File path copied to clipboard (relative)')).catch(() => toast.error('Could not copy path'));
                                }}><Copy className="mr-2 h-4 w-4" />Copy</Button>
                                <Button size="sm" variant="ghost" onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}>Open</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleDeleteFile(f.name)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
          </div>
        </div>
      )}
    </div>
  );
}
