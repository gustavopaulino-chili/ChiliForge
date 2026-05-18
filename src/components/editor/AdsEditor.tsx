import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronRight, Code2, GripVertical, Plus, Download, FileText, ArrowDown, ArrowUp, Trash2, Copy, FolderOpen, ImagePlus, Layers, Palette, Pencil, Redo2, Settings2, Undo2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldLabel } from '@/components/generator/FieldLabel';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { deleteProjectAssetFile, generateImages, getProjectAssets, ProjectAsset, uploadProjectAssets, uploadProjectAssetsFromUrls, getProjectFiles, uploadProjectFiles, deleteProjectFile } from '@/services/api';
import { downloadFileFromUrl } from '@/lib/downloadFile';
import { toast } from 'sonner';


const HISTORY_LIMIT = 60;
const FLOATING_TOOLBAR_MIN_TOP = 72;
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
  { name: 'Embedded Form', label: 'Embedded Form', icon: <FileText size={16} /> },
  { name: 'Embedded', label: 'Embedded', icon: <Code2 size={14} /> },
];

const EMBEDDED_SECTION_TYPES = new Set(['Embedded', 'Embedded Form', 'Forms Embedded']);

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
  ancestors?: Array<{ tag: string; path: string }>;
  boundingRect?: { top: number; left: number; width: number; height: number };
};

type VisualEditorProps = {
  html: string;
  onChange: (nextHtml: string) => void;
  saving?: boolean;
  projectId?: number | null;
  userId?: number | null;
  projectPublicUrl?: string;
  brandPalette?: string[];
  brandColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    text?: string;
    background?: string;
  };
  /** 'split' = iframe left + panel right (default); 'overlay' = iframe full-screen + floating toggle panel */
  layout?: 'split' | 'overlay';
};

type AdsLayer = {
  path: string;
  parentPath: string;
  tag: string;
  title: string;
  depth: number;
  zIndex: string;
};

type OverlayMode = 'none' | 'color' | 'gradient' | 'dark' | 'mask';

const EDITOR_MESSAGE_SOURCE = 'chiliforge-ads-editor';

const BRIDGE_STYLE_CONTENT = '.cf-editor-hover{outline:2px dashed #06b6d4 !important; outline-offset:2px !important; cursor:move !important;}\n.cf-editor-selected{outline:3px solid #0891b2 !important; outline-offset:2px !important; cursor:move !important;}\n.cf-editor-editing{outline:2px solid #3b82f6 !important; outline-offset:2px !important; cursor:text !important; background:rgba(59,130,246,0.04) !important;}\n.cf-editor-dragging{outline:3px solid #22d3ee !important; outline-offset:2px !important; cursor:grabbing !important; user-select:none !important;}\n.ad-banner,.creative-frame,.creative-scale{position:relative;}';

const BRIDGE_SCRIPT_CONTENT = `(function(){
  var SOURCE='${EDITOR_MESSAGE_SOURCE}';
  var TEXT_EDIT_TAGS=new Set(['p','span','h1','h2','h3','h4','h5','h6','a','label','strong','em','small','li','blockquote','button','figcaption','td','th']);
  var isEditing=false;
  var editingEl=null;
  var editingOriginal='';
  var lastClickTarget=null;
  var lastClickTime=0;
  var dragState=null;
  var suppressClickUntil=0;

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
  function getAncestors(el){
    var result=[];
    var node=el.parentElement;
    while(node && node!==document.body){
      result.unshift({ tag: node.tagName.toLowerCase(), path: cssPath(node) });
      node=node.parentElement;
    }
    return result;
  }
  function getInfo(el){
    var cs=window.getComputedStyle(el);
    var rect=el.getBoundingClientRect();
    return {
      path: cssPath(el),
      sectionPath: closestSectionPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 500),
      ancestors: getAncestors(el),
      boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
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
  function serializeEditorDocument(){
    var clone=document.documentElement.cloneNode(true);
    try {
      clone.querySelector('#cf-editor-base')?.remove();
      clone.querySelector('#cf-editor-bridge-style')?.remove();
      clone.querySelector('#cf-editor-bridge-script')?.remove();
      clone.querySelector('#cf-editor-resize-overlay')?.remove();
      clone.querySelectorAll('.cf-editor-hover,.cf-editor-selected,.cf-editor-editing,.cf-editor-dragging').forEach(function(node){
        node.classList.remove('cf-editor-hover','cf-editor-selected','cf-editor-editing','cf-editor-dragging');
        if(!node.getAttribute('class')) node.removeAttribute('class');
      });
      clone.querySelectorAll('[data-cf-editor-id]').forEach(function(node){ node.removeAttribute('data-cf-editor-id'); });
    } catch(e) {}
    return '<!DOCTYPE html>\\n' + clone.outerHTML;
  }
  function postMutation(){
    try {
      window.parent.postMessage({ source: SOURCE, type: 'ads-dom-mutated', payload: { html: serializeEditorDocument() } }, '*');
    } catch(e) {}
  }
  function isCanvasRoot(el){
    if(!el || !el.classList) return false;
    return el === document.body ||
      el.classList.contains('creative-board') ||
      el.classList.contains('creative-grid') ||
      el.classList.contains('creative-frame') ||
      el.classList.contains('creative-scale') ||
      el.classList.contains('ad-banner');
  }
  function draggableTarget(target){
    if(!(target instanceof HTMLElement)) return null;
    if(target.closest('[contenteditable="true"]')) return null;
    var el=target.closest('img,a,button,h1,h2,h3,h4,h5,h6,p,span,strong,em,small,figure,svg,div');
    if(!(el instanceof HTMLElement)) return null;
    while(el && isCanvasRoot(el) && el.parentElement && el.parentElement!==document.body){
      el=el.parentElement.closest('img,a,button,h1,h2,h3,h4,h5,h6,p,span,strong,em,small,figure,svg,div');
    }
    if(!el || el===document.body || el===document.documentElement || isCanvasRoot(el)) return null;
    return el;
  }
  function ensureCanvasParent(target){
    var parent=target.offsetParent instanceof HTMLElement ? target.offsetParent : target.parentElement;
    if(!parent || parent===document.documentElement) parent=document.body;
    var ps=window.getComputedStyle(parent);
    if(parent!==document.body && ps.position==='static') parent.style.position='relative';
    return parent;
  }
  function finishEditing(cancel){
    if(!editingEl || !isEditing) return;
    var el=editingEl;
    if(!cancel){
      var path=cssPath(el);
      var innerHTML=el.innerHTML;
      try {
        window.parent.postMessage({ source: SOURCE, type: 'inline-text-save', payload: { path: path, innerHTML: innerHTML } }, '*');
      } catch(e){}
    } else {
      el.innerHTML=editingOriginal;
    }
    el.removeAttribute('contenteditable');
    el.classList.remove('cf-editor-editing');
    isEditing=false;
    editingEl=null;
    editingOriginal='';
  }
  var lastHover = null;
  var lastSelected = null;
  document.addEventListener('mouseover', function(ev){
    if(isEditing) return;
    var t=ev.target;
    if(!(t instanceof Element)) return;
    if(lastHover && lastHover!==lastSelected){ lastHover.classList.remove('cf-editor-hover'); }
    if(t !== lastSelected){ t.classList.add('cf-editor-hover'); lastHover=t; }
  }, true);
  document.addEventListener('mouseout', function(){
    if(isEditing) return;
    if(lastHover && lastHover!==lastSelected){ lastHover.classList.remove('cf-editor-hover'); }
  }, true);
  document.addEventListener('click', function(ev){
    if(isEditing) return;
    if(Date.now()<suppressClickUntil){ ev.preventDefault(); ev.stopPropagation(); return; }
    var t=ev.target;
    if(!(t instanceof Element)) return;
    ev.preventDefault();
    ev.stopPropagation();
    var now=Date.now();
    var isRepeat=(now-lastClickTime<400) && (t===lastClickTarget || (lastClickTarget && lastClickTarget.contains(t)));
    if(isRepeat && lastClickTarget && lastClickTarget.parentElement && lastClickTarget.parentElement!==document.body){
      t=lastClickTarget.parentElement;
    }
    lastClickTarget=t;
    lastClickTime=now;
    if(lastSelected){ lastSelected.classList.remove('cf-editor-selected'); }
    if(lastHover){ lastHover.classList.remove('cf-editor-hover'); }
    lastSelected=t;
    t.classList.add('cf-editor-selected');
    postSelect(t);
  }, true);
  document.addEventListener('mousedown', function(ev){
    if(isEditing) return;
    if(ev.button!==0 || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    var t=draggableTarget(ev.target);
    if(!t) return;
    var parent=ensureCanvasParent(t);
    var tr=t.getBoundingClientRect();
    var pr=parent.getBoundingClientRect();
    var cs=window.getComputedStyle(t);
    var left=parseFloat(cs.left);
    var top=parseFloat(cs.top);
    dragState={
      target:t,
      parent:parent,
      startX:ev.clientX,
      startY:ev.clientY,
      initialLeft:(cs.position==='absolute'||cs.position==='fixed') && Number.isFinite(left) ? left : tr.left - pr.left + parent.scrollLeft,
      initialTop:(cs.position==='absolute'||cs.position==='fixed') && Number.isFinite(top) ? top : tr.top - pr.top + parent.scrollTop,
      dragging:false
    };
  }, true);
  document.addEventListener('mousemove', function(ev){
    if(!dragState) return;
    var dx=ev.clientX-dragState.startX;
    var dy=ev.clientY-dragState.startY;
    if(!dragState.dragging && Math.sqrt(dx*dx+dy*dy)<3) return;
    dragState.dragging=true;
    ev.preventDefault();
    ev.stopPropagation();
    var t=dragState.target;
    var cs=window.getComputedStyle(t);
    if(cs.position==='static' || cs.position==='relative'){
      var op=t.offsetParent instanceof HTMLElement ? t.offsetParent : document.body;
      var tBr=t.getBoundingClientRect();
      var opBr=op.getBoundingClientRect();
      var absLeft=Math.round(tBr.left - opBr.left + op.scrollLeft);
      var absTop=Math.round(tBr.top - opBr.top + op.scrollTop);
      var w=tBr.width;
      var h=tBr.height;
      t.style.position='absolute';
      t.style.margin='0';
      t.style.left=absLeft+'px';
      t.style.top=absTop+'px';
      if(!t.style.width && w>0) t.style.width=Math.round(w)+'px';
      if(!t.style.height && h>0 && ['IMG','VIDEO','CANVAS','SVG'].includes(t.tagName)) t.style.height=Math.round(h)+'px';
      dragState.initialLeft=absLeft;
      dragState.initialTop=absTop;
      dragState.startX=ev.clientX;
      dragState.startY=ev.clientY;
      dx=0; dy=0;
    }
    if(!t.style.zIndex || t.style.zIndex==='auto') t.style.zIndex='20';
    t.style.left=Math.round(dragState.initialLeft+dx)+'px';
    t.style.top=Math.round(dragState.initialTop+dy)+'px';
    t.classList.add('cf-editor-dragging');
  }, true);
  document.addEventListener('mouseup', function(ev){
    if(!dragState) return;
    var state=dragState;
    dragState=null;
    if(state.dragging){
      ev.preventDefault();
      ev.stopPropagation();
      suppressClickUntil=Date.now()+250;
      state.target.classList.remove('cf-editor-dragging');
      if(lastSelected){ lastSelected.classList.remove('cf-editor-selected'); }
      lastSelected=state.target;
      state.target.classList.add('cf-editor-selected');
      postSelect(state.target);
      postMutation();
    }
  }, true);
  document.addEventListener('dblclick', function(ev){
    if(isEditing) return;
    var t=ev.target;
    if(!(t instanceof Element)) return;
    var tag=t.tagName.toLowerCase();
    if(!TEXT_EDIT_TAGS.has(tag)) return;
    ev.preventDefault();
    ev.stopPropagation();
    editingEl=t;
    editingOriginal=t.innerHTML;
    isEditing=true;
    t.setAttribute('contenteditable','true');
    t.classList.remove('cf-editor-selected');
    t.classList.add('cf-editor-editing');
    t.focus();
    try {
      var range=document.createRange();
      range.selectNodeContents(t);
      range.collapse(false);
      var sel=window.getSelection();
      if(sel){ sel.removeAllRanges(); sel.addRange(range); }
    } catch(e){}
  }, true);
  document.addEventListener('keydown', function(ev){
    if(isEditing){
      if(ev.key==='Escape'){ ev.preventDefault(); ev.stopPropagation(); finishEditing(true); return; }
      var tag=editingEl ? editingEl.tagName.toLowerCase() : '';
      var isBlock=(tag==='h1'||tag==='h2'||tag==='h3'||tag==='h4'||tag==='h5'||tag==='h6'||tag==='button');
      if(ev.key==='Enter' && isBlock && !ev.shiftKey){ ev.preventDefault(); finishEditing(false); }
      return;
    }
    if(!lastSelected || lastSelected===document.body || lastSelected===document.documentElement) return;
    if(ev.key==='Delete' || ev.key==='Backspace'){
      ev.preventDefault();
      var el=lastSelected;
      lastSelected=null;
      lastHover=null;
      el.remove();
      postMutation();
      try { window.parent.postMessage({ source: SOURCE, type: 'deselect' }, '*'); } catch(e) {}
      return;
    }
    var step=ev.shiftKey ? 10 : 1;
    var nudgeX=0, nudgeY=0;
    if(ev.key==='ArrowLeft'){ nudgeX=-step; }
    else if(ev.key==='ArrowRight'){ nudgeX=step; }
    else if(ev.key==='ArrowUp'){ nudgeY=-step; }
    else if(ev.key==='ArrowDown'){ nudgeY=step; }
    if(nudgeX!==0 || nudgeY!==0){
      ev.preventDefault();
      var nt=lastSelected;
      var ncs=window.getComputedStyle(nt);
      if(ncs.position==='static'){ nt.style.position='relative'; }
      var nl=parseFloat(nt.style.left || ncs.left) || 0;
      var ntp=parseFloat(nt.style.top || ncs.top) || 0;
      nt.style.left=(nl+nudgeX)+'px';
      nt.style.top=(ntp+nudgeY)+'px';
      postMutation();
    }
    if(ev.key==='Escape'){
      if(lastSelected){ lastSelected.classList.remove('cf-editor-selected'); lastSelected=null; }
      try { window.parent.postMessage({ source: SOURCE, type: 'deselect' }, '*'); } catch(e) {}
    }
  }, false);
  document.addEventListener('blur', function(ev){
    if(!isEditing) return;
    var t=ev.relatedTarget;
    if(t && editingEl && editingEl.contains(t)) return;
    if(ev.target===editingEl){ finishEditing(false); }
  }, true);
  window.__cfSelectByPath=function(path){
    try {
      var el=document.querySelector(path);
      if(el){ postSelect(el); }
    } catch(e){}
  };
})();`;

const rgbToHex = (value: string) => {
  if (!value) return '#111111';
  if (value.startsWith('#')) return value;
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return '#111111';
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

const normalizeHexColor = (value: string) => {
  const raw = (value || '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return '';
  const body = match[1].slice(0, 6);
  const full = body.length === 3
    ? body.split('').map((char) => char + char).join('')
    : body.padEnd(6, '0').slice(0, 6);
  return `#${full.toLowerCase()}`;
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

const cssColorToComparableHex = (value: string) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('#')) return normalizeHexColor(raw);
  if (/^rgba?\(/i.test(raw)) return normalizeHexColor(rgbToHex(raw));
  return '';
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

const parseBoxShadowValue = (val: string) => {
  if (!val || val === 'none') return null;
  const inset = /\binset\b/.test(val);
  const cleaned = val.replace(/\binset\b/g, '').trim();
  const rgbaMatch = cleaned.match(/rgba?\([^)]+\)/);
  const colorStr = rgbaMatch ? rgbaMatch[0] : 'rgba(0,0,0,1)';
  const nums = cleaned.replace(/rgba?\([^)]+\)/g, '').trim().split(/\s+/).filter(Boolean);
  const x = parseFloat(nums[0] || '0');
  const y = parseFloat(nums[1] || '0');
  const blur = parseFloat(nums[2] || '0');
  const spread = parseFloat(nums[3] || '0');
  const { hex, alpha } = parseColorWithAlpha(colorStr);
  return { inset, x, y, blur, spread, color: hex || '#000000', opacity: alpha };
};

const parseTextShadowValue = (val: string) => {
  if (!val || val === 'none') return null;
  const rgbaMatch = val.match(/rgba?\([^)]+\)/);
  const colorStr = rgbaMatch ? rgbaMatch[0] : 'rgba(0,0,0,1)';
  const nums = val.replace(/rgba?\([^)]+\)/g, '').trim().split(/\s+/).filter(Boolean);
  const x = parseFloat(nums[0] || '0');
  const y = parseFloat(nums[1] || '0');
  const blur = parseFloat(nums[2] || '0');
  const { hex, alpha } = parseColorWithAlpha(colorStr);
  return { x, y, blur, color: hex || '#000000', opacity: alpha };
};

const replaceGlobalColorInHtml = (sourceHtml: string, fromColor: string, toColor: string) => {
  const from = normalizeHexColor(fromColor);
  const to = normalizeHexColor(toColor);
  if (!sourceHtml || !from || !to || from === to) return sourceHtml;

  let next = sourceHtml.replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi, (match) => (
    normalizeHexColor(match) === from ? to : match
  ));

  next = next.replace(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/gi, (match) => {
    if (cssColorToComparableHex(match) !== from) return match;
    const alpha = match.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/i)?.[1]?.trim();
    if (!alpha) return to;

    const full = to.replace('#', '');
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  });

  return next;
};

const extractCssVarColorFromHtml = (sourceHtml: string, varName: string): string => {
  const match = sourceHtml.match(new RegExp(`--${varName}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'i'));
  return match ? normalizeHexColor(match[1]) : '';
};

const extractCssVarValueFromHtml = (sourceHtml: string, varName: string): string => {
  const match = sourceHtml.match(new RegExp(`--${varName}\\s*:\\s*([^;\\}\\n]+)`, 'i'));
  return match ? match[1].trim() : '';
};

const BRAND_COLOR_CSS_VAR: Record<string, string> = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
  text: 'text',
  background: 'bg',
};

const updateCssVarInHtml = (sourceHtml: string, varName: string, newValue: string): string => {
  return sourceHtml.replace(
    new RegExp(`(--${varName}\\s*:\\s*)[^;\\}]+`, 'gi'),
    `$1${newValue}`,
  );
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
  const parentBase = /\/b\d+\/$/i.test(base) ? base.replace(/\/b\d+\/$/i, '/') : base;
  return `${parentBase}assets/`;
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

const cleanBridgeFromDocument = (doc: Document, preserveSelectionMarker = false) => {
  doc.querySelector('#cf-editor-base')?.remove();
  doc.querySelector('#cf-editor-bridge-style')?.remove();
  doc.querySelector('#cf-editor-bridge-script')?.remove();
  doc.querySelector('#cf-editor-resize-overlay')?.remove();
  doc.querySelectorAll('.cf-editor-hover, .cf-editor-selected').forEach((node) => {
    node.classList.remove('cf-editor-hover', 'cf-editor-selected');
  });
  if (!preserveSelectionMarker) {
    doc.querySelectorAll('[data-cf-editor-id]').forEach((node) => {
      node.removeAttribute('data-cf-editor-id');
    });
  }
};

const serializeWithoutBridge = (doc: Document): string => {
  // Serialize to string first (outerHTML is fast), then strip bridge artifacts with regex.
  // This avoids an O(n) cloneNode(true) on the full document for every single mutation.
  let html = serializeDocument(doc);
  // Remove bridge script and style tags entirely
  html = html.replace(/<script\b[^>]*\bid="cf-editor-bridge-script"[^>]*>[\s\S]*?<\/script>/i, '');
  html = html.replace(/<style\b[^>]*\bid="cf-editor-bridge-style"[^>]*>[\s\S]*?<\/style>/i, '');
  html = html.replace(/<base\b[^>]*\bid="cf-editor-base"[^>]*\/?>/gi, '');
  html = html.replace(/<div\b[^>]*\bid="cf-editor-resize-overlay"[^>]*>[\s\S]*?<\/div>/i, '');
  // Strip bridge CSS class names, then normalize class attribute whitespace
  html = html.replace(/\bcf-editor-(?:hover|selected|editing)\b/g, '');
  html = html.replace(/class="([^"]*)"/g, (_, cls) => {
    const cleaned = cls.replace(/\s+/g, ' ').trim();
    return cleaned ? `class="${cleaned}"` : '';
  });
  // Remove selection marker attributes
  html = html.replace(/\s+data-cf-editor-id="[^"]*"/g, '');
  return html;
};

const injectBridgeIntoDocument = (doc: Document) => {
  cleanBridgeFromDocument(doc, true);

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

export function AdsEditor({
  html,
  onChange,
  saving = false,
  projectId,
  userId,
  projectPublicUrl,
  brandPalette = [],
  brandColors,
  layout = 'split',
}: VisualEditorProps) {
  // ...existing code...

  // Embedded code modal state
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [embedCode, setEmbedCode] = useState('');
  const [pendingSectionType, setPendingSectionType] = useState<string | null>(null);
  const [pendingEmbedMode, setPendingEmbedMode] = useState<'section' | 'element' | null>(null);

  // Adiciona uma nova sessão predefinida ao final do body, com embed opcional
  const addPredefinedSection = (type: string) => {
    // Only open embed modal for embedded section types. For other types, insert immediately.
    if (EMBEDDED_SECTION_TYPES.has(type)) {
      setPendingSectionType(type);
      setPendingEmbedMode('section');
      setEmbedCode('');
      setShowEmbedModal(true);
      return;
    }
    insertPredefinedSection(type);
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
    'Embedded Form': `
      <section class="w-full py-16 md:py-24 bg-background">
        <div class="container mx-auto px-4">
          <div class="mx-auto text-center" style="width:50%;max-width:880px;margin-left:auto;margin-right:auto;">
            <h1 class="text-2xl md:text-3xl font-bold mb-2" contenteditable="true">Embedded Form</h1>
            <p class="text-muted-foreground mb-4" contenteditable="true">Embedded Form</p>
            <div class="cf-embed-placeholder mx-auto" style="min-height:160px">EMBEDDED APLICADO NA PAGINA</div>
          </div>
        </div>
      </section>
    `,
    'Forms Embedded': `
      <section class="w-full py-16 md:py-24 bg-background">
        <div class="container mx-auto px-4">
          <div class="mx-auto text-center" style="width:50%;max-width:880px;margin-left:auto;margin-right:auto;">
            <h1 class="text-2xl md:text-3xl font-bold mb-2" contenteditable="true">Embedded Form</h1>
            <p class="text-muted-foreground mb-4" contenteditable="true">Embedded Form</p>
            <div class="cf-embed-placeholder mx-auto" style="min-height:160px">EMBEDDED APLICADO NA PAGINA</div>
          </div>
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

  const ELEMENT_TEMPLATES: Record<string, { label: string; icon: string; html: string }> = {
    Paragraph: {
      label: 'Paragraph',
      icon: '¶',
      html: '<p style="margin:0.75rem 0;">New text paragraph.</p>',
    },
    Heading: {
      label: 'Heading',
      icon: 'H',
      html: '<h2 style="margin:0.75rem 0;">New Heading</h2>',
    },
    Button: {
      label: 'Button',
      icon: '▬',
      html: '<a href="#" style="display:inline-block;padding:0.6rem 1.4rem;border-radius:6px;background:#000;color:#fff;text-decoration:none;font-weight:600;">Button</a>',
    },
    Image: {
      label: 'Image',
      icon: '⬚',
      html: '<img src="https://placehold.co/600x300" alt="Image" style="max-width:100%;height:auto;display:block;margin:0.5rem 0;" />',
    },
    Divider: {
      label: 'Divider',
      icon: '—',
      html: '<hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0;" />',
    },
    List: {
      label: 'List',
      icon: '≡',
      html: '<ul style="padding-left:1.5rem;margin:0.75rem 0;"><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>',
    },
    Container: {
      label: 'Container',
      icon: '□',
      html: '<div style="padding:1rem;border:1px dashed #d1d5db;border-radius:6px;margin:0.5rem 0;min-height:3rem;"></div>',
    },
    Embedded: {
      label: 'Embedded',
      icon: '</>',
      html: '',
    },
  };

  const normalizeEmbedSnippet = (doc: Document, rawCode: string) => {
    let raw = rawCode && rawCode.trim() ? rawCode.trim() : '<div>EMBEDDED APLICADO NA PAGINA</div>';
    raw = raw.replace(/^```(?:html|javascript|js)?\s*/i, '').replace(/```$/i, '').trim();

    for (let i = 0; i < 3 && /&(?:lt|gt|amp|quot|#39);/i.test(raw); i += 1) {
      const textarea = doc.createElement('textarea');
      textarea.innerHTML = raw;
      const decoded = textarea.value.trim();
      if (!decoded || decoded === raw) break;
      raw = decoded;
    }

    if (
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
      && raw.slice(1, -1).includes('<')
    ) {
      raw = raw.slice(1, -1).trim();
    }

    return raw;
  };

  const appendEmbedCode = (doc: Document, targetParent: Element, rawCode: string) => {
    const raw = normalizeEmbedSnippet(doc, rawCode);

    // Clear the target container
    while (targetParent.firstChild) {
      targetParent.removeChild(targetParent.firstChild);
    }

    const embedWrapper = doc.createElement('div');
    embedWrapper.className = 'cf-embed-container';
    embedWrapper.style.width = '100%';
    embedWrapper.style.minHeight = '200px';

    // Set innerHTML so the browser parses iframes, forms, divs, etc. as real HTML nodes.
    // Scripts parsed via innerHTML are inert — we must recreate them via createElement so they execute.
    embedWrapper.innerHTML = raw;

    const inertScripts = Array.from(embedWrapper.querySelectorAll('script'));
    inertScripts.forEach((oldScript) => {
      const newScript = doc.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
      const src = oldScript.getAttribute('src');
      if (src) {
        newScript.src = src;
      } else {
        newScript.textContent = oldScript.textContent || '';
      }
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    });

    // Ensure iframes without explicit width/height get sensible defaults
    embedWrapper.querySelectorAll('iframe').forEach((iframe) => {
      if (!iframe.style.width && !iframe.getAttribute('width')) iframe.style.width = '100%';
      if (!iframe.style.height && !iframe.getAttribute('height')) iframe.style.minHeight = '200px';
    });

    targetParent.appendChild(embedWrapper);
  };

  const insertPredefinedSection = (type: string, code = '') => {
    applyMutation('body', (el, doc) => {
      let sectionHtml = SECTION_HTML_TEMPLATES[type] || `<section class="cf-section cf-section-${type.toLowerCase().replace(/\s+/g, '-')}"><h2>${type}</h2><p>Section content: ${type}</p></section>`;
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

      if (EMBEDDED_SECTION_TYPES.has(type)) {
        const templateHtml = SECTION_HTML_TEMPLATES[type] || SECTION_HTML_TEMPLATES['Embedded'] || `<section class="cf-section cf-section-embedded"><h2>Embedded</h2><p>Embedded</p><div class="cf-embed-placeholder"></div></section>`;
        const wrapperForSection = doc.createElement('div');
        wrapperForSection.innerHTML = templateHtml.trim();
        const sectionNode = wrapperForSection.firstElementChild as HTMLElement;
        if (!sectionNode) return;
        placeNode(sectionNode);
        const placedSection = doc.querySelectorAll('.cf-embed-placeholder');
        const targetParent = Array.from(placedSection).reverse().find(p => sectionNode.contains(p)) || sectionNode;
        appendEmbedCode(doc, targetParent, code);
      } else if (code && code.trim()) {
        sectionHtml = sectionHtml.replace(/<\/section>\s*$/, `${code}\n</section>`);
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
  };

  const closeEmbedModal = () => {
    setShowEmbedModal(false);
    setEmbedCode('');
    setPendingSectionType(null);
    setPendingEmbedMode(null);
  };

  const confirmAddSectionWithEmbed = () => {
    if (!pendingSectionType) return;
    insertPredefinedSection(pendingSectionType, embedCode);
    closeEmbedModal();
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
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number; width: number } | null>(null);
  const [selectedAncestors, setSelectedAncestors] = useState<Array<{ tag: string; path: string }>>([]);
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
  // Box Shadow
  const [boxShadowEnabled, setBoxShadowEnabled] = useState(false);
  const [boxShadowX, setBoxShadowX] = useState(0);
  const [boxShadowY, setBoxShadowY] = useState(4);
  const [boxShadowBlur, setBoxShadowBlur] = useState(8);
  const [boxShadowSpread, setBoxShadowSpread] = useState(0);
  const [boxShadowColor, setBoxShadowColor] = useState('#000000');
  const [boxShadowOpacity, setBoxShadowOpacity] = useState(20);
  const [boxShadowInset, setBoxShadowInset] = useState(false);
  // Text Shadow
  const [textShadowEnabled, setTextShadowEnabled] = useState(false);
  const [textShadowX, setTextShadowX] = useState(0);
  const [textShadowY, setTextShadowY] = useState(2);
  const [textShadowBlur, setTextShadowBlur] = useState(4);
  const [textShadowColor, setTextShadowColor] = useState('#000000');
  const [textShadowOpacity, setTextShadowOpacity] = useState(40);
  // Hover styles
  const [hoverTextColorEnabled, setHoverTextColorEnabled] = useState(false);
  const [hoverTextColor, setHoverTextColor] = useState('#000000');
  const [hoverBgColorEnabled, setHoverBgColorEnabled] = useState(false);
  const [hoverBgColor, setHoverBgColor] = useState('#ffffff');
  const [hoverBgOpacity, setHoverBgOpacity] = useState(100);
  const [hoverTransitionEnabled, setHoverTransitionEnabled] = useState(false);
  const [hoverTransitionDuration, setHoverTransitionDuration] = useState(200);
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
  const [editorPanelTab, setEditorPanelTab] = useState<'content' | 'style' | 'advanced'>('content');
  const [, setHistoryVersion] = useState(0);
  const brandPaletteKey = brandPalette.map((value) => normalizeHexColor(value || '')).filter(Boolean).join('|');
  const initialBrandColors = useMemo(() => ({
    primary: normalizeHexColor(brandColors?.primary || brandPalette[0] || ''),
    secondary: normalizeHexColor(brandColors?.secondary || brandPalette[1] || ''),
    accent: normalizeHexColor(brandColors?.accent || brandPalette[2] || ''),
    text: normalizeHexColor(brandColors?.text || brandPalette[3] || ''),
    background: normalizeHexColor(brandColors?.background || brandPalette[4] || ''),
  }), [brandColors?.primary, brandColors?.secondary, brandColors?.accent, brandColors?.text, brandColors?.background, brandPaletteKey]);
  const [globalBrandColors, setGlobalBrandColors] = useState(initialBrandColors);
  const brandColorMatchRef = useRef<Record<string, boolean>>({});
  const [brandColorsOpen, setBrandColorsOpen] = useState(false);
  const [geminiChatOpen, setGeminiChatOpen] = useState(true);
  const [isPanMode, setIsPanMode] = useState(false);
  const [floatingAddElOpen, setFloatingAddElOpen] = useState(false);
  const [floatingLayersOpen, setFloatingLayersOpen] = useState(false);
  const [layersPanelRect, setLayersPanelRect] = useState<{ top: number; left: number } | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [showEditorGrid, setShowEditorGrid] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [smartResizePreset, setSmartResizePreset] = useState('1080x1080');
  const [imageScale, setImageScale] = useState(100);
  const [toolbarAddElOpen, setToolbarAddElOpen] = useState(false);
  const [floatingAddTab, setFloatingAddTab] = useState<'element' | 'sections'>('element');
  const [toolbarAddTab, setToolbarAddTab] = useState<'element' | 'sections'>('element');
  const floatingAddElPopoverRef = useRef<HTMLDivElement | null>(null);
  const floatingLayersPopoverRef = useRef<HTMLDivElement | null>(null);
  const layersBtnRef = useRef<HTMLButtonElement | null>(null);
  const toolbarAddElPopoverRef = useRef<HTMLDivElement | null>(null);
  const nextGeneratedImageIdRef = useRef(1);
  const historyPastRef = useRef<string[]>([]);
  const historyFutureRef = useRef<string[]>([]);
  const lastHtmlRef = useRef('');
  const latestHtmlRef = useRef(html);
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

  useEffect(() => { latestHtmlRef.current = html; }, [html]);

  useEffect(() => {
    setGlobalBrandColors(initialBrandColors);
  }, [initialBrandColors]);

  const activeBrandPalette = useMemo(() => {
    const values = [
      globalBrandColors.primary,
      globalBrandColors.secondary,
      globalBrandColors.accent,
      globalBrandColors.text,
      globalBrandColors.background,
      ...brandPalette,
    ].map((value) => normalizeHexColor(value || '')).filter(Boolean);

    return values.filter((value, index) => values.indexOf(value) === index);
  }, [globalBrandColors, brandPaletteKey]);

  const adsEditorChromeStyle = useMemo(() => ({
    '--cf-ads-primary': '#995AF2',
    '--cf-ads-primary-strong': '#7C3AED',
    '--cf-ads-accent': '#C084FC',
    '--cf-ads-text': '#F8FAFC',
    '--cf-ads-muted': '#B8A8D9',
    '--cf-ads-panel': '#10091C',
    '--cf-ads-panel-2': '#171021',
    '--cf-ads-border': 'rgba(153, 90, 242, 0.34)',
  }) as CSSProperties, []);

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

      // Write the latest html prop into the iframe so the editor always shows the
      // current saved state — not the stale published file that may not have been updated.
      const latestHtml = latestHtmlRef.current;
      if (latestHtml && latestHtml.trim()) {
        const base = (projectPublicUrl || '').trim();
        const normalized = base ? base.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/') : '';
        const absoluteBase = normalized ? new URL(normalized, window.location.origin).href : '';
        let htmlToWrite = latestHtml.replace(/<base\b[^>]*>/gi, '');
        if (absoluteBase) {
          htmlToWrite = htmlToWrite.replace(/(<head\b[^>]*>)/i, `$1\n<base href="${absoluteBase}">`);
        }
        doc.open();
        doc.write(htmlToWrite);
        doc.close();
      }

      injectBridgeIntoDocument(doc);

      const docWithHandler = doc as Document & {
        __cfParentSelectionHandler?: EventListener;
        __cfAdsDragMouseDownHandler?: EventListener;
        __cfAdsDragMouseMoveHandler?: EventListener;
        __cfAdsDragMouseUpHandler?: EventListener;
        __cfAdsResizeMouseDownHandler?: EventListener;
        __cfAdsResizeMouseMoveHandler?: EventListener;
        __cfAdsResizeMouseUpHandler?: EventListener;
      };
      if (docWithHandler.__cfParentSelectionHandler) {
        doc.removeEventListener('click', docWithHandler.__cfParentSelectionHandler, true);
      }
      if (docWithHandler.__cfAdsDragMouseDownHandler) {
        doc.removeEventListener('mousedown', docWithHandler.__cfAdsDragMouseDownHandler, true);
      }
      if (docWithHandler.__cfAdsDragMouseMoveHandler) {
        doc.removeEventListener('mousemove', docWithHandler.__cfAdsDragMouseMoveHandler, true);
      }
      if (docWithHandler.__cfAdsDragMouseUpHandler) {
        doc.removeEventListener('mouseup', docWithHandler.__cfAdsDragMouseUpHandler, true);
      }
      if (docWithHandler.__cfAdsResizeMouseDownHandler) {
        doc.removeEventListener('mousedown', docWithHandler.__cfAdsResizeMouseDownHandler, true);
      }
      if (docWithHandler.__cfAdsResizeMouseMoveHandler) {
        doc.removeEventListener('mousemove', docWithHandler.__cfAdsResizeMouseMoveHandler, true);
      }
      if (docWithHandler.__cfAdsResizeMouseUpHandler) {
        doc.removeEventListener('mouseup', docWithHandler.__cfAdsResizeMouseUpHandler, true);
      }
      doc.getElementById('cf-editor-resize-overlay')?.remove();

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

      const buildSelectionPayload = (target: Element): SelectedNode => {
        const frameWindow = doc.defaultView;
        const computed = frameWindow?.getComputedStyle(target) || ({} as CSSStyleDeclaration);
        const rect = target.getBoundingClientRect();
        return {
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
          boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        };
      };

      const ensureAbsoluteEditableLayer = (target: HTMLElement, parent: HTMLElement) => {
        const frameWindow = doc.defaultView;
        const computed = frameWindow?.getComputedStyle(target);
        const targetRect = target.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const left = Math.round(targetRect.left - parentRect.left + parent.scrollLeft);
        const top = Math.round(targetRect.top - parentRect.top + parent.scrollTop);
        const widthPx = Math.max(1, Math.round(targetRect.width));
        const heightPx = Math.max(1, Math.round(targetRect.height));

        if (computed?.position === 'static' || computed?.position === 'relative' || !target.style.position) {
          target.style.position = 'absolute';
          target.style.left = `${left}px`;
          target.style.top = `${top}px`;
          target.style.margin = '0';
        }

        if (!target.style.width && widthPx > 0) {
          target.style.width = `${widthPx}px`;
        }
        if (!target.style.height && heightPx > 0 && !['SPAN', 'STRONG', 'EM', 'SMALL'].includes(target.tagName)) {
          target.style.height = `${heightPx}px`;
        }
        if (!target.style.zIndex || target.style.zIndex === 'auto') {
          target.style.zIndex = '10';
        }
      };

      const isNonEditableCanvasLayer = (element: HTMLElement) => (
        element === doc.body ||
        element.classList.contains('ad-banner') ||
        element.classList.contains('creative-board') ||
        element.classList.contains('creative-grid') ||
        element.classList.contains('creative-frame') ||
        element.classList.contains('creative-scale') ||
        element.classList.contains('ad-bg')
      );

      const updateResizeOverlay = (target: HTMLElement | null) => {
        let overlay = doc.getElementById('cf-editor-resize-overlay') as HTMLDivElement | null;
        if (!target || isNonEditableCanvasLayer(target)) {
          overlay?.remove();
          return;
        }

        if (!overlay) {
          overlay = doc.createElement('div');
          overlay.id = 'cf-editor-resize-overlay';
          overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:1px solid rgba(34,211,238,.95);box-shadow:0 0 0 1px rgba(2,6,23,.35);';
          doc.body.appendChild(overlay);
        }

        const rect = target.getBoundingClientRect();
        overlay.dataset.targetPath = buildCssPath(target);
        overlay.style.left = `${Math.round(rect.left)}px`;
        overlay.style.top = `${Math.round(rect.top)}px`;
        overlay.style.width = `${Math.max(1, Math.round(rect.width))}px`;
        overlay.style.height = `${Math.max(1, Math.round(rect.height))}px`;
        overlay.innerHTML = '';

        const handles: Array<{ dir: string; cursor: string; style: Partial<CSSStyleDeclaration> }> = [
          { dir: 'e', cursor: 'ew-resize', style: { right: '-5px', top: '50%', transform: 'translateY(-50%)' } },
          { dir: 's', cursor: 'ns-resize', style: { left: '50%', bottom: '-5px', transform: 'translateX(-50%)' } },
          { dir: 'se', cursor: 'nwse-resize', style: { right: '-5px', bottom: '-5px' } },
          { dir: 'nw', cursor: 'nwse-resize', style: { left: '-5px', top: '-5px' } },
        ];

        handles.forEach(({ dir, cursor, style }) => {
          const handle = doc.createElement('button');
          handle.type = 'button';
          handle.dataset.resizeHandle = dir;
          handle.style.cssText = 'position:absolute;width:10px;height:10px;border:1px solid rgba(255,255,255,.95);border-radius:999px;background:#22d3ee;box-shadow:0 1px 6px rgba(0,0,0,.35);padding:0;pointer-events:auto;';
          Object.assign(handle.style, style);
          handle.style.cursor = cursor;
          overlay?.appendChild(handle);
        });
      };

      const parentSelectionHandler: EventListener = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('#cf-editor-resize-overlay')) return;

        const payload = buildSelectionPayload(target);
        if (target instanceof HTMLElement) updateResizeOverlay(target);

        window.postMessage({ source: EDITOR_MESSAGE_SOURCE, type: 'select', payload }, '*');
      };

      doc.addEventListener('click', parentSelectionHandler, true);
      docWithHandler.__cfParentSelectionHandler = parentSelectionHandler;

      let dragState: {
        target: HTMLElement;
        parent: HTMLElement;
        startX: number;
        startY: number;
        initialLeft: number;
        initialTop: number;
        initialWidth: number;
        initialHeight: number;
        dragging: boolean;
      } | null = null;

      const getEditableDragTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return null;
        if (target.closest('#cf-editor-bridge-script, #cf-editor-bridge-style, #cf-editor-resize-overlay')) return null;
        const element = target.closest('img,a,button,h1,h2,h3,h4,h5,h6,p,span,strong,em,small,div,figure,section,article') as HTMLElement | null;
        if (!element || element === doc.body || element === doc.documentElement) return null;
        if (isNonEditableCanvasLayer(element)) return null;
        if (element.closest('[contenteditable="true"]')) return null;
        return element;
      };

      const dragMouseDownHandler: EventListener = (event) => {
        const mouse = event as MouseEvent;
        if (mouse.button !== 0 || mouse.altKey || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) return;
        const target = getEditableDragTarget(mouse.target);
        if (!target) return;

        const frameWindow = doc.defaultView;
        if (!frameWindow) return;

        const parent = (target.offsetParent || target.parentElement || doc.body) as HTMLElement;
        const parentStyle = frameWindow.getComputedStyle(parent);
        if (parent !== doc.body && parentStyle.position === 'static') {
          parent.style.position = 'relative';
        }
        ensureAbsoluteEditableLayer(target, parent);

        const targetRect = target.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const computed = frameWindow.getComputedStyle(target);
        const existingLeft = Number.parseFloat(computed.left);
        const existingTop = Number.parseFloat(computed.top);
        const initialLeft = Number.isFinite(existingLeft) && computed.position !== 'static'
          ? existingLeft
          : targetRect.left - parentRect.left + parent.scrollLeft;
        const initialTop = Number.isFinite(existingTop) && computed.position !== 'static'
          ? existingTop
          : targetRect.top - parentRect.top + parent.scrollTop;

        dragState = {
          target,
          parent,
          startX: mouse.clientX,
          startY: mouse.clientY,
          initialLeft,
          initialTop,
          initialWidth: targetRect.width,
          initialHeight: targetRect.height,
          dragging: false,
        };
      };

      const dragMouseMoveHandler: EventListener = (event) => {
        if (!dragState) return;
        const mouse = event as MouseEvent;
        const dx = mouse.clientX - dragState.startX;
        const dy = mouse.clientY - dragState.startY;

        if (!dragState.dragging && Math.hypot(dx, dy) < 4) return;

        dragState.dragging = true;
        mouse.preventDefault();
        mouse.stopPropagation();

        const target = dragState.target;
        const computed = doc.defaultView?.getComputedStyle(target);
        if (computed?.position === 'static' || !target.style.position) {
          target.style.position = 'absolute';
          target.style.margin = '0';
        }
        if (!target.style.zIndex || target.style.zIndex === 'auto') {
          target.style.zIndex = '10';
        }
        target.style.left = `${Math.round(dragState.initialLeft + dx)}px`;
        target.style.top = `${Math.round(dragState.initialTop + dy)}px`;
        updateResizeOverlay(target);
      };

      const dragMouseUpHandler: EventListener = (event) => {
        if (!dragState) return;
        const wasDragging = dragState.dragging;
        const target = dragState.target;
        dragState = null;
        if (wasDragging) {
          const mouse = event as MouseEvent;
          mouse.preventDefault();
          mouse.stopPropagation();
          updateResizeOverlay(target);
          window.postMessage({ source: EDITOR_MESSAGE_SOURCE, type: 'select', payload: buildSelectionPayload(target) }, '*');
          emitChange(serializeWithoutBridge(doc));
        }
      };

      let resizeState: {
        target: HTMLElement;
        parent: HTMLElement;
        dir: string;
        startX: number;
        startY: number;
        initialLeft: number;
        initialTop: number;
        initialWidth: number;
        initialHeight: number;
        aspectRatio: number;
        resizing: boolean;
      } | null = null;

      const resizeMouseDownHandler: EventListener = (event) => {
        const mouse = event as MouseEvent;
        const handle = (mouse.target instanceof HTMLElement)
          ? mouse.target.closest('[data-resize-handle]') as HTMLElement | null
          : null;
        if (!handle) return;

        const selectedPath = handle.closest('#cf-editor-resize-overlay')?.getAttribute('data-target-path') || selectedRef.current?.path;
        const target = selectedPath ? doc.querySelector(selectedPath) as HTMLElement | null : null;
        if (!target || isNonEditableCanvasLayer(target)) return;

        const parent = (target.offsetParent || target.parentElement || doc.body) as HTMLElement;
        const parentStyle = doc.defaultView?.getComputedStyle(parent);
        if (parent !== doc.body && parentStyle?.position === 'static') {
          parent.style.position = 'relative';
        }
        ensureAbsoluteEditableLayer(target, parent);

        const rect = target.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        resizeState = {
          target,
          parent,
          dir: handle.dataset.resizeHandle || 'se',
          startX: mouse.clientX,
          startY: mouse.clientY,
          initialLeft: rect.left - parentRect.left + parent.scrollLeft,
          initialTop: rect.top - parentRect.top + parent.scrollTop,
          initialWidth: Math.max(1, rect.width),
          initialHeight: Math.max(1, rect.height),
          aspectRatio: rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1,
          resizing: false,
        };

        mouse.preventDefault();
        mouse.stopPropagation();
      };

      const resizeMouseMoveHandler: EventListener = (event) => {
        if (!resizeState) return;
        const mouse = event as MouseEvent;
        const dx = mouse.clientX - resizeState.startX;
        const dy = mouse.clientY - resizeState.startY;
        if (!resizeState.resizing && Math.hypot(dx, dy) < 3) return;

        resizeState.resizing = true;
        mouse.preventDefault();
        mouse.stopPropagation();

        const target = resizeState.target;
        const dir = resizeState.dir;
        const preserveRatio = mouse.shiftKey;
        let nextLeft = resizeState.initialLeft;
        let nextTop = resizeState.initialTop;
        let nextWidth = resizeState.initialWidth;
        let nextHeight = resizeState.initialHeight;

        if (dir.includes('e')) nextWidth = resizeState.initialWidth + dx;
        if (dir.includes('s')) nextHeight = resizeState.initialHeight + dy;
        if (dir.includes('w')) {
          nextWidth = resizeState.initialWidth - dx;
          nextLeft = resizeState.initialLeft + dx;
        }
        if (dir.includes('n')) {
          nextHeight = resizeState.initialHeight - dy;
          nextTop = resizeState.initialTop + dy;
        }

        nextWidth = Math.max(24, nextWidth);
        nextHeight = Math.max(24, nextHeight);

        if (preserveRatio && resizeState.aspectRatio > 0) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            nextHeight = nextWidth / resizeState.aspectRatio;
          } else {
            nextWidth = nextHeight * resizeState.aspectRatio;
          }
          if (dir.includes('w')) nextLeft = resizeState.initialLeft + resizeState.initialWidth - nextWidth;
          if (dir.includes('n')) nextTop = resizeState.initialTop + resizeState.initialHeight - nextHeight;
        }

        target.style.position = 'absolute';
        target.style.margin = '0';
        target.style.left = `${Math.round(nextLeft)}px`;
        target.style.top = `${Math.round(nextTop)}px`;
        target.style.width = `${Math.round(nextWidth)}px`;
        target.style.height = `${Math.round(nextHeight)}px`;
        if (!target.style.zIndex || target.style.zIndex === 'auto') {
          target.style.zIndex = '10';
        }
        updateResizeOverlay(target);
      };

      const resizeMouseUpHandler: EventListener = (event) => {
        if (!resizeState) return;
        const state = resizeState;
        resizeState = null;
        if (!state.resizing) return;
        const mouse = event as MouseEvent;
        mouse.preventDefault();
        mouse.stopPropagation();
        updateResizeOverlay(state.target);
        window.postMessage({ source: EDITOR_MESSAGE_SOURCE, type: 'select', payload: buildSelectionPayload(state.target) }, '*');
        emitChange(serializeWithoutBridge(doc));
      };

      doc.addEventListener('mousedown', resizeMouseDownHandler, true);
      doc.addEventListener('mousedown', dragMouseDownHandler, true);
      doc.addEventListener('mousemove', dragMouseMoveHandler, true);
      doc.addEventListener('mouseup', dragMouseUpHandler, true);
      doc.addEventListener('mousemove', resizeMouseMoveHandler, true);
      doc.addEventListener('mouseup', resizeMouseUpHandler, true);
      docWithHandler.__cfAdsResizeMouseDownHandler = resizeMouseDownHandler;
      docWithHandler.__cfAdsResizeMouseMoveHandler = resizeMouseMoveHandler;
      docWithHandler.__cfAdsResizeMouseUpHandler = resizeMouseUpHandler;
      docWithHandler.__cfAdsDragMouseDownHandler = dragMouseDownHandler;
      docWithHandler.__cfAdsDragMouseMoveHandler = dragMouseMoveHandler;
      docWithHandler.__cfAdsDragMouseUpHandler = dragMouseUpHandler;

      const serialized = serializeWithoutBridge(doc);
      if (serialized && stripEditorBridge(serialized).trim() !== stripEditorBridge(html).trim()) {
        emitChange(serialized);
      }
    } catch {
      toast.error('Live mode could not access the page DOM.');
    }
  }, [html, emitChange, projectPublicUrl]);

  useEffect(() => { setIframeReady(false); }, [livePreviewUrl]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !iframeReady) return;

    let styleEl = doc.getElementById('cf-editor-guides') as HTMLStyleElement | null;
    if (!showEditorGrid && !showSafeZones) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'cf-editor-guides';
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      .ad-banner::before,[data-platform][data-format]::before{
        content:"";position:absolute;inset:0;pointer-events:none;z-index:99997;
        ${showEditorGrid ? "background-image:linear-gradient(rgba(153,90,242,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(153,90,242,.22) 1px,transparent 1px);background-size:8px 8px;" : ""}
      }
      .ad-banner::after,[data-platform][data-format]::after{
        content:"";position:absolute;pointer-events:none;z-index:99998;
        ${showSafeZones ? "inset:6%;border:2px dashed rgba(34,211,238,.75);box-shadow:0 0 0 9999px rgba(2,6,23,.10);" : "display:none;"}
      }
    `;
  }, [iframeReady, showEditorGrid, showSafeZones]);

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
    setTimeout(() => {
      const doc = iframeRef.current?.contentDocument;
      if (doc) writeHtmlToIframeDoc(doc, previous);
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
    // Do NOT re-inject the bridge here. The bridge script uses event delegation on
    // document and remains valid across DOM mutations. Re-injecting after every
    // applyMutation re-executes the IIFE and accumulates duplicate event listeners.
    emitChange(serializeWithoutBridge(doc));
  }, [emitChange]);

  const applyMutationRef = useRef(applyMutation);
  applyMutationRef.current = applyMutation;

  useEffect(() => {
    if (!selected) {
      setToolbarPos(null);
      setSelectedAncestors([]);
      setFloatingAddElOpen(false);
      setToolbarAddElOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!floatingAddElOpen) return;
    const handler = (e: MouseEvent) => {
      if (floatingAddElPopoverRef.current && !floatingAddElPopoverRef.current.contains(e.target as Node)) {
        setFloatingAddElOpen(false);
      }
    };
    const frameHandler = () => setFloatingAddElOpen(false);
    const frameDoc = iframeRef.current?.contentDocument;
    document.addEventListener('mousedown', handler);
    frameDoc?.addEventListener('mousedown', frameHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      frameDoc?.removeEventListener('mousedown', frameHandler);
    };
  }, [floatingAddElOpen]);

  useEffect(() => {
    if (!floatingLayersOpen) return;
    const handler = (e: MouseEvent) => {
      if (floatingLayersPopoverRef.current && !floatingLayersPopoverRef.current.contains(e.target as Node)) {
        setFloatingLayersOpen(false);
      }
    };
    const frameHandler = () => setFloatingLayersOpen(false);
    const frameDoc = iframeRef.current?.contentDocument;
    document.addEventListener('mousedown', handler);
    frameDoc?.addEventListener('mousedown', frameHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      frameDoc?.removeEventListener('mousedown', frameHandler);
    };
  }, [floatingLayersOpen]);

  useEffect(() => {
    if (!toolbarAddElOpen) return;
    const handler = (e: MouseEvent) => {
      if (toolbarAddElPopoverRef.current && !toolbarAddElPopoverRef.current.contains(e.target as Node)) {
        setToolbarAddElOpen(false);
      }
    };
    const frameHandler = () => setToolbarAddElOpen(false);
    const frameDoc = iframeRef.current?.contentDocument;
    document.addEventListener('mousedown', handler);
    frameDoc?.addEventListener('mousedown', frameHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      frameDoc?.removeEventListener('mousedown', frameHandler);
    };
  }, [toolbarAddElOpen]);

  const updateToolbarPositionForSelection = useCallback(() => {
    if (!selected?.path) {
      setToolbarPos(null);
      return;
    }

    try {
      const iframeRect = iframeRef.current?.getBoundingClientRect();
      const doc = iframeRef.current?.contentDocument;
      const target = doc?.querySelector(selected.path) as HTMLElement | null;
      if (!iframeRect || !target) return;

      const rect = target.getBoundingClientRect();
      setToolbarPos({
        x: iframeRect.left + rect.left,
        y: iframeRect.top + rect.top - 48,
        width: rect.width,
      });
    } catch {
      // Keep the last known toolbar position if the selected element is briefly unavailable.
    }
  }, [selected?.path]);

  useEffect(() => {
    if (!selected?.path || !iframeReady) return;

    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateToolbarPositionForSelection();
      });
    };

    scheduleUpdate();

    const frameWindow = iframeRef.current?.contentWindow;
    frameWindow?.addEventListener('scroll', scheduleUpdate, { passive: true });
    frameWindow?.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      frameWindow?.removeEventListener('scroll', scheduleUpdate);
      frameWindow?.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [iframeReady, selected?.path, updateToolbarPositionForSelection]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== EDITOR_MESSAGE_SOURCE) return;

      if (data.type === 'inline-text-save') {
        const p = data.payload as { path: string; innerHTML: string };
        if (p?.path) {
          applyMutationRef.current(p.path, (el) => {
            el.innerHTML = p.innerHTML || '';
          });
        }
        return;
      }

      if (data.type === 'ads-dom-mutated') {
        const p = data.payload as { html?: string };
        if (typeof p?.html === 'string' && p.html.trim()) {
          emitChange(p.html);
          updateToolbarPositionForSelection();
        }
        return;
      }

      if (data.type === 'deselect') {
        setSelected(null);
        setToolbarPos(null);
        return;
      }

      if (data.type !== 'select') return;
      const payload = data.payload as SelectedNode;

      // Only update toolbar position and ancestors when the bridge provides boundingRect.
      // parentSelectionHandler fires a second 'select' without boundingRect — skip it so the
      // toolbar is not immediately destroyed after the bridge sets it.
      if (payload.boundingRect) {
        try {
          const iframeRect = iframeRef.current?.getBoundingClientRect();
          if (iframeRect) {
            const x = iframeRect.left + payload.boundingRect.left;
            const y = iframeRect.top + payload.boundingRect.top - 48;
            setToolbarPos({ x, y, width: payload.boundingRect.width });
          }
        } catch {}
        setSelectedAncestors(payload.ancestors || []);
      }
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
                if (node.classList && (node.classList.contains('cf-embed-element') || node.classList.contains('cf-embed-container') || node.classList.contains('cf-embed-placeholder') || node.classList.contains('cf-section-embedded'))) {
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
      setImageScale(100);
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
      // Read box-shadow and text-shadow from computed styles
      try {
        const shadowDoc = iframeRef.current?.contentDocument;
        const shadowEl = shadowDoc?.querySelector(payload.path) as HTMLElement | null;
        if (shadowEl) {
          const cs = window.getComputedStyle(shadowEl);
          const bsv = cs.boxShadow || '';
          if (bsv && bsv !== 'none') {
            const parsed = parseBoxShadowValue(bsv);
            if (parsed) {
              setBoxShadowEnabled(true);
              setBoxShadowX(parsed.x);
              setBoxShadowY(parsed.y);
              setBoxShadowBlur(parsed.blur);
              setBoxShadowSpread(parsed.spread);
              setBoxShadowColor(parsed.color);
              setBoxShadowOpacity(parsed.opacity);
              setBoxShadowInset(parsed.inset);
            } else { setBoxShadowEnabled(false); }
          } else {
            setBoxShadowEnabled(false);
            setBoxShadowX(0); setBoxShadowY(4); setBoxShadowBlur(8);
            setBoxShadowSpread(0); setBoxShadowColor('#000000');
            setBoxShadowOpacity(20); setBoxShadowInset(false);
          }
          const tsv = cs.textShadow || '';
          if (tsv && tsv !== 'none') {
            const parsed = parseTextShadowValue(tsv);
            if (parsed) {
              setTextShadowEnabled(true);
              setTextShadowX(parsed.x); setTextShadowY(parsed.y);
              setTextShadowBlur(parsed.blur); setTextShadowColor(parsed.color);
              setTextShadowOpacity(parsed.opacity);
            } else { setTextShadowEnabled(false); }
          } else {
            setTextShadowEnabled(false);
            setTextShadowX(0); setTextShadowY(2); setTextShadowBlur(4);
            setTextShadowColor('#000000'); setTextShadowOpacity(40);
          }
        }
      } catch (_e) {}
      // Read hover styles from <style id="cf-hover-styles">
      try {
        const hoverDoc = iframeRef.current?.contentDocument;
        const hoverStyleEl = hoverDoc?.getElementById('cf-hover-styles') as HTMLStyleElement | null;
        if (hoverStyleEl) {
          const escapedSel = (payload.path + ':hover').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const ruleMatch = (hoverStyleEl.textContent || '').match(new RegExp(escapedSel + '\\s*\\{([^}]*)\\}'));
          if (ruleMatch) {
            const decls = ruleMatch[1];
            const colorMatch = decls.match(/(?:^|;)\s*color\s*:\s*(rgba?\([^)]+\)|#[0-9a-f]+)/i);
            if (colorMatch) { const { hex } = parseColorWithAlpha(colorMatch[1]); setHoverTextColor(hex || '#000000'); setHoverTextColorEnabled(true); }
            else { setHoverTextColorEnabled(false); setHoverTextColor('#000000'); }
            const bgMatch = decls.match(/(?:^|;)\s*background-color\s*:\s*(rgba?\([^)]+\)|#[0-9a-f]+)/i);
            if (bgMatch) { const { hex, alpha } = parseColorWithAlpha(bgMatch[1]); setHoverBgColor(hex || '#ffffff'); setHoverBgOpacity(alpha); setHoverBgColorEnabled(true); }
            else { setHoverBgColorEnabled(false); setHoverBgColor('#ffffff'); }
          } else {
            setHoverTextColorEnabled(false); setHoverTextColor('#000000');
            setHoverBgColorEnabled(false); setHoverBgColor('#ffffff');
          }
        } else {
          setHoverTextColorEnabled(false); setHoverBgColorEnabled(false);
        }
      } catch (_e) {}
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
      // For background-image elements: capture the current URL before mutating
      const frameWindow = doc.defaultView;
      const oldBgUrl = (() => {
        const inlineMatch = (targetEl as HTMLElement).style.backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
        if (inlineMatch?.[1]) return inlineMatch[1];
        const computed = frameWindow?.getComputedStyle(targetEl as Element);
        const compMatch = (computed?.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/i);
        return compMatch?.[1] || '';
      })();
      applyMutation(targetPath, (el, mutDoc) => {
        (el as HTMLElement).style.setProperty('background-image', `url('${nextSrc}')`, 'important');
        // Also patch every <style> block so the CSS rule agrees with the new URL.
        // This prevents CSS !important rules from fighting the inline !important on reload.
        if (oldBgUrl && oldBgUrl !== nextSrc) {
          const escaped = oldBgUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          mutDoc.querySelectorAll('style').forEach((styleEl) => {
            if (styleEl.textContent?.includes(oldBgUrl)) {
              styleEl.textContent = styleEl.textContent.replace(new RegExp(escaped, 'g'), nextSrc);
            }
          });
        }
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
    nextScale: number;
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
    const nextScale = overrides?.nextScale ?? imageScale;

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

          if (nextScale && nextScale !== 100) {
            img.style.transform = `scale(${Math.max(10, Math.min(300, nextScale)) / 100})`;
            img.style.transformOrigin = nextPosition || 'center';
          } else {
            img.style.removeProperty('transform');
            img.style.removeProperty('transform-origin');
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
          const bgSize = nextScale && nextScale !== 100
            ? `${Math.max(10, Math.min(300, nextScale))}%`
            : nextFit === 'cover'
              ? 'cover'
              : nextFit === 'contain'
                ? 'contain'
                : nextFit;
          target.style.backgroundSize = bgSize || target.style.backgroundSize;
          target.style.setProperty('background-image', composeBackgroundImageWithOverlay({
            imageUrl: currentBgUrl,
            overlayMode: nextOverlayMode,
            overlayColor: nextOverlayColor,
            overlayOpacity: nextOverlayOpacity,
            overlayGrad1: nextOverlayGrad1,
            overlayGrad2: nextOverlayGrad2,
            overlayAngle: nextOverlayAngle,
            darkOpacity: nextDarkOverlayStrength,
          }), 'important');
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

  const duplicateSectionByPath = (sectionPath: string) => {
    if (!sectionPath) return;

    applyMutation(sectionPath, (el) => {
      const copy = el.cloneNode(true) as Element;
      el.insertAdjacentElement('afterend', copy);
    });
  };

  const duplicateSection = () => {
    const sectionPath = selected?.sectionPath;
    if (!sectionPath) return;
    duplicateSectionByPath(sectionPath);
  };

  const insertElement = (type: string) => {
    if (type === 'Embedded') {
      setPendingSectionType(null);
      setPendingEmbedMode('element');
      setEmbedCode('');
      setShowEmbedModal(true);
      return;
    }

    const template = ELEMENT_TEMPLATES[type];
    if (!template) return;

    const parser = new DOMParser();
    const parsed = parser.parseFromString(template.html, 'text/html');
    const newNode = parsed.body.firstChild;
    if (!newNode) return;

    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    const sectionPath = selected?.sectionPath ?? (selected?.tag === 'section' ? selected.path : null);
    if (!sectionPath) return;

    applyMutation(sectionPath, (sectionEl, doc) => {
      const cloned = doc.importNode(newNode, true);

      // Find the top-level child of sectionEl that wraps the currently selected element,
      // then insert the new element right after it.
      const selectedEl = selected?.path ? iframeDoc.querySelector(selected.path) : null;
      let insertAfter: Element | null = null;
      if (selectedEl && selectedEl !== sectionEl) {
        let candidate: Element | null = selectedEl as Element;
        while (candidate && candidate.parentElement !== sectionEl) {
          candidate = candidate.parentElement;
        }
        if (candidate && candidate.parentElement === sectionEl) {
          insertAfter = candidate;
        }
      }

      if (insertAfter) {
        insertAfter.insertAdjacentElement('afterend', cloned as Element);
      } else {
        sectionEl.appendChild(cloned);
      }
    });

    setFloatingAddElOpen(false);
    setToolbarAddElOpen(false);
  };

  const insertEmbeddedElement = (code: string) => {
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    const sectionPath = selected?.sectionPath ?? (selected?.tag === 'section' ? selected.path : null);
    if (!sectionPath) return;

    applyMutation(sectionPath, (sectionEl, doc) => {
      const embedHost = doc.createElement('div');
      embedHost.className = 'cf-embed-element';
      embedHost.style.width = '100%';
      embedHost.style.height = 'auto';
      embedHost.style.minHeight = '200px';
      embedHost.style.margin = '0.75rem 0';
      appendEmbedCode(doc, embedHost, code);

      const selectedEl = selected?.path ? iframeDoc.querySelector(selected.path) : null;
      let insertAfter: Element | null = null;
      if (selectedEl && selectedEl !== sectionEl) {
        let candidate: Element | null = selectedEl as Element;
        while (candidate && candidate.parentElement !== sectionEl) {
          candidate = candidate.parentElement;
        }
        if (candidate && candidate.parentElement === sectionEl) {
          insertAfter = candidate;
        }
      }

      if (insertAfter) {
        insertAfter.insertAdjacentElement('afterend', embedHost);
      } else {
        sectionEl.appendChild(embedHost);
      }
    });

    setFloatingAddElOpen(false);
    setToolbarAddElOpen(false);
  };

  const confirmAddEmbed = () => {
    if (pendingEmbedMode === 'element') {
      insertEmbeddedElement(embedCode);
      closeEmbedModal();
      return;
    }

    confirmAddSectionWithEmbed();
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

  const duplicateSelectedElement = () => {
    const elementPath = selected?.path;
    if (!elementPath) return;

    applyMutation(elementPath, (el) => {
      const copy = el.cloneNode(true) as Element;
      el.insertAdjacentElement('afterend', copy);
    });
  };

  const moveSelectedElementUp = () => {
    const elementPath = selected?.path;
    if (!elementPath) return;

    applyMutation(elementPath, (el) => {
      const previous = el.previousElementSibling;
      if (previous) previous.before(el);
    });
  };

  const moveSelectedElementDown = () => {
    const elementPath = selected?.path;
    if (!elementPath) return;

    applyMutation(elementPath, (el) => {
      const next = el.nextElementSibling;
      if (next) next.after(el);
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

  const applyShadowLive = (overrides?: Partial<{
    nextBoxEnabled: boolean; nextBoxX: number; nextBoxY: number;
    nextBoxBlur: number; nextBoxSpread: number; nextBoxColor: string;
    nextBoxOpacity: number; nextBoxInset: boolean;
    nextTextEnabled: boolean; nextTextX: number; nextTextY: number;
    nextTextBlur: number; nextTextColor: string; nextTextOpacity: number;
  }>) => {
    if (!selected?.path) return;
    const boxEnabled = overrides?.nextBoxEnabled !== undefined ? overrides.nextBoxEnabled : boxShadowEnabled;
    const boxX = overrides?.nextBoxX ?? boxShadowX;
    const boxY = overrides?.nextBoxY ?? boxShadowY;
    const boxBlur = overrides?.nextBoxBlur ?? boxShadowBlur;
    const boxSpread = overrides?.nextBoxSpread ?? boxShadowSpread;
    const boxColor = overrides?.nextBoxColor ?? boxShadowColor;
    const boxOpacity = overrides?.nextBoxOpacity ?? boxShadowOpacity;
    const boxInset = overrides?.nextBoxInset !== undefined ? overrides.nextBoxInset : boxShadowInset;
    const textEnabled = overrides?.nextTextEnabled !== undefined ? overrides.nextTextEnabled : textShadowEnabled;
    const textX = overrides?.nextTextX ?? textShadowX;
    const textY = overrides?.nextTextY ?? textShadowY;
    const textBlur = overrides?.nextTextBlur ?? textShadowBlur;
    const textColor = overrides?.nextTextColor ?? textShadowColor;
    const textOpacity = overrides?.nextTextOpacity ?? textShadowOpacity;
    applyMutation(selected.path, (el) => {
      const t = el as HTMLElement;
      if (boxEnabled) {
        t.style.boxShadow = `${boxInset ? 'inset ' : ''}${boxX}px ${boxY}px ${boxBlur}px ${boxSpread}px ${hexToRgba(boxColor, boxOpacity)}`;
      } else {
        t.style.removeProperty('box-shadow');
      }
      if (textEnabled) {
        t.style.textShadow = `${textX}px ${textY}px ${textBlur}px ${hexToRgba(textColor, textOpacity)}`;
      } else {
        t.style.removeProperty('text-shadow');
      }
    });
  };

  const applyHoverStyleLive = (overrides?: Partial<{
    nextTextEnabled: boolean; nextTextColor: string;
    nextBgEnabled: boolean; nextBgColor: string; nextBgOpacity: number;
    nextTransitionEnabled: boolean; nextTransitionDuration: number;
  }>) => {
    if (!selected?.path) return;
    const textEnabled = overrides?.nextTextEnabled !== undefined ? overrides.nextTextEnabled : hoverTextColorEnabled;
    const textColor = overrides?.nextTextColor ?? hoverTextColor;
    const bgEnabled = overrides?.nextBgEnabled !== undefined ? overrides.nextBgEnabled : hoverBgColorEnabled;
    const bgColor = overrides?.nextBgColor ?? hoverBgColor;
    const bgOpacity = overrides?.nextBgOpacity ?? hoverBgOpacity;
    const transEnabled = overrides?.nextTransitionEnabled !== undefined ? overrides.nextTransitionEnabled : hoverTransitionEnabled;
    const transDuration = overrides?.nextTransitionDuration ?? hoverTransitionDuration;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    let styleEl = doc.getElementById('cf-hover-styles') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'cf-hover-styles';
      (doc.head || doc.documentElement).appendChild(styleEl);
    }
    const selector = selected.path + ':hover';
    const escapedSel = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declarations: string[] = [];
    if (textEnabled && textColor) declarations.push(`color: ${hexToRgba(textColor, 100)} !important`);
    if (bgEnabled && bgColor) declarations.push(`background-color: ${hexToRgba(bgColor, bgOpacity)} !important`);
    const existing = styleEl.textContent || '';
    const ruleRegex = new RegExp(escapedSel + '\\s*\\{[^}]*\\}', 'g');
    let updated: string;
    if (declarations.length > 0) {
      const newRule = `${selector} { ${declarations.join('; ')}; }`;
      updated = ruleRegex.test(existing)
        ? existing.replace(new RegExp(escapedSel + '\\s*\\{[^}]*\\}', 'g'), newRule)
        : existing + '\n' + newRule;
    } else {
      updated = existing.replace(new RegExp(escapedSel + '\\s*\\{[^}]*\\}', 'g'), '');
    }
    styleEl.textContent = updated;
    // Apply or remove transition on the element inline style
    const target = doc.querySelector(selected.path) as HTMLElement | null;
    if (target) {
      if (transEnabled) {
        target.style.transition = `all ${transDuration}ms ease`;
      } else {
        target.style.removeProperty('transition');
      }
    }
    emitChange(serializeWithoutBridge(doc));
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
      return Boolean(el.closest('#top, #hero, #hero-section, #banner, #main-hero, .hero-section, .hero-carousel, .hero, .hero-area, .hero-wrapper, .hero-banner, .banner-section, .main-hero, .landing-hero, header.hero, section.hero, div.hero, header[id*="hero"], section[id*="hero"], [class*="hero-section"], [class*="hero-banner"]'));
    } catch {
      return false;
    }
  };

  const resolveHeroTargetPath = (): { path: string; isBackground: boolean } | null => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return null;

      const heroSelectors = [
        '#top', '#hero', '#hero-section', '#banner', '#main-hero',
        '.hero-section', '.hero-carousel', '.hero', '.hero-area', '.hero-wrapper',
        '.hero-banner', '.banner-section', '.main-hero', '.landing-hero',
        'header.hero', 'section.hero', 'div.hero',
        'header[id*="hero"]', 'section[id*="hero"]',
        '[class*="hero-section"]', '[class*="hero-banner"]',
      ];
      const heroClosestStr = heroSelectors.join(', ');
      let heroEl: Element | null = null;
      for (const selector of heroSelectors) {
        try { heroEl = doc.querySelector(selector); } catch { continue; }
        if (heroEl) break;
      }

      if (!heroEl && selected?.path) {
        const selectedEl = doc.querySelector(selected.path) as HTMLElement | null;
        heroEl = selectedEl?.closest(heroClosestStr) as Element | null ?? null;
      }

      // Last resort: first body child that has a computed background-image
      if (!heroEl) {
        const topLevelEls = Array.from(doc.querySelectorAll('body > section, body > header, body > div'));
        for (const el of topLevelEls.slice(0, 3)) {
          const cs = doc.defaultView?.getComputedStyle(el as Element);
          if (cs?.backgroundImage && cs.backgroundImage !== 'none') { heroEl = el; break; }
          if ((el as HTMLElement).style?.backgroundImage) { heroEl = el; break; }
        }
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

  const buildHtmlWithBase = (nextHtml: string) => {
    const base = (projectPublicUrl || '').trim();
    if (!base) return nextHtml;
    const normalized = base.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
    const absoluteBase = new URL(normalized, window.location.origin).href;
    let result = nextHtml.replace(/<base\b[^>]*>/gi, '');
    result = result.replace(/(<head\b[^>]*>)/i, `$1\n<base href="${absoluteBase}">`);
    return result;
  };

  const writeHtmlToIframeDoc = (doc: Document, nextHtml: string) => {
    doc.open();
    doc.write(buildHtmlWithBase(nextHtml));
    doc.close();
    injectBridgeIntoDocument(doc);
  };

  const writeHtmlToIframe = (nextHtml: string) => {
    setTimeout(() => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      writeHtmlToIframeDoc(doc, nextHtml);
    }, 0);
  };

  const applyGlobalBrandColor = (
    key: keyof typeof globalBrandColors,
    label: string,
    nextColor: string,
  ) => {
    const currentHtml = stripEditorBridge(html);
    const cssVarName = BRAND_COLOR_CSS_VAR[key];
    const previousFromHtml = cssVarName ? extractCssVarColorFromHtml(currentHtml, cssVarName) : '';
    const previous = previousFromHtml || normalizeHexColor(globalBrandColors[key] || '');
    const next = normalizeHexColor(nextColor);
    if (!next) return;

    setGlobalBrandColors((current) => ({ ...current, [key]: next }));
    if (!previous || previous === next) return;

    // 1. Replace CSS variable definition (format-agnostic)
    let updatedHtml = cssVarName ? updateCssVarInHtml(currentHtml, cssVarName, next) : currentHtml;
    // 2. Replace any hardcoded hex occurrences
    if (previous) updatedHtml = replaceGlobalColorInHtml(updatedHtml, previous, next);
    // 3. Instant DOM update in iframe
    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc && cssVarName) {
      try { iframeDoc.documentElement.style.setProperty(`--${cssVarName}`, next); } catch {}
    }

    const didChange = updatedHtml !== currentHtml;
    brandColorMatchRef.current[key] = didChange;
    if (!didChange) return;

    setSelected(null);
    emitChange(updatedHtml);
    writeHtmlToIframe(updatedHtml);
  };

  const applyGlobalCssVar = (varName: string, newValue: string) => {
    const currentHtml = stripEditorBridge(html);
    const updatedHtml = updateCssVarInHtml(currentHtml, varName, newValue);
    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      try { iframeDoc.documentElement.style.setProperty(`--${varName}`, newValue); } catch {}
    }
    if (updatedHtml !== currentHtml) emitChange(updatedHtml);
  };

  const startImagePan = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !selected?.path) return;
    const capturedPath = selected.path;
    const img = doc.querySelector(capturedPath) as HTMLImageElement | null;
    if (!img) return;
    const parent = img.parentElement as HTMLElement | null;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const overlay = doc.createElement('div');
    overlay.id = 'cf-pan-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;cursor:crosshair;z-index:999;background:transparent;';
    parent.appendChild(overlay);
    setIsPanMode(true);

    let panRafId: number | null = null;
    const handleMove = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
      // Apply to DOM immediately for smooth visual feedback
      img.style.objectPosition = `${x}% ${y}%`;
      // Throttle React state updates to one per animation frame to avoid 3×setState at 60fps
      if (panRafId !== null) return;
      panRafId = requestAnimationFrame(() => {
        panRafId = null;
        setImagePosition(`${x}% ${y}%`);
        setImagePositionX(x);
        setImagePositionY(y);
      });
    };
    const handleUp = () => {
      if (panRafId !== null) { cancelAnimationFrame(panRafId); panRafId = null; }
      overlay.remove();
      doc.removeEventListener('mousemove', handleMove, true);
      doc.removeEventListener('mouseup', handleUp, true);
      document.removeEventListener('mousemove', handleMove, true);
      document.removeEventListener('mouseup', handleUp, true);
      const finalPos = img.style.objectPosition || '50% 50%';
      applyMutation(capturedPath, (el) => { (el as HTMLImageElement).style.objectPosition = finalPos; });
      setIsPanMode(false);
    };
    doc.addEventListener('mousemove', handleMove, true);
    doc.addEventListener('mouseup', handleUp, true);
    // Also listen on the parent window so dragging outside the iframe still works
    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('mouseup', handleUp, true);
  };

  const renderBrandPaletteSwatches = (
    keyPrefix: string,
    onApply: (color: string) => void,
    titleBuilder?: (color: string) => string,
  ) => {
    if (activeBrandPalette.length === 0) return null;

    return (
      <div className="mb-1 flex flex-wrap gap-1">
        {activeBrandPalette.map((color) => (
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
        : await uploadProjectAssetsFromUrls(projectId, userId, [item.imageUrl], [`${fileBase}-${Date.now()}`]);
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

  const iframeEl = (
    <div className="relative h-full w-full bg-muted/20">
      {!panelOpen && (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md border border-border/70 bg-background/95 p-1 shadow">
            <Button
              size="sm"
              variant={layout === 'overlay' ? 'default' : 'ghost'}
              className="h-8 gap-1.5 px-2"
              title="Open editor panel"
              onClick={() => {
                setToolbarPos(null);
                setToolbarAddElOpen(false);
                setPanelOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
              {layout === 'overlay' && <span className="text-xs">Edit</span>}
            </Button>
        </div>
      )}

      <div className="absolute left-3 top-3 z-30">
        <Button
          ref={layersBtnRef}
          size="sm"
          className="h-9 gap-2 rounded-md shadow-lg"
          style={{ background: '#995AF2', color: '#fff' }}
          onClick={() => {
            setToolbarPos(null);
            setToolbarAddElOpen(false);
            setFloatingAddElOpen(false);
            setEditorTab('element');
            const rect = layersBtnRef.current?.getBoundingClientRect();
            if (rect) setLayersPanelRect({ top: rect.bottom + 4, left: rect.left });
            setFloatingLayersOpen((value) => !value);
          }}
          title="Layers"
        >
          <Layers className="h-4 w-4" />
          Layers
        </Button>
      </div>

      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md border border-white/20 bg-black/60 px-2 py-1 shadow backdrop-blur-sm">
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/15 text-base leading-none font-bold"
          title="Zoom out"
          onClick={() => setCanvasZoom(z => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
        >−</button>
        <button
          className="min-w-[38px] text-center text-[11px] font-semibold text-white/80 hover:text-white cursor-pointer"
          title="Reset zoom"
          onClick={() => setCanvasZoom(1)}
        >{Math.round(canvasZoom * 100)}%</button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-white/80 hover:bg-white/15 text-base leading-none font-bold"
          title="Zoom in"
          onClick={() => setCanvasZoom(z => Math.min(2, Math.round((z + 0.25) * 100) / 100))}
        >+</button>
      </div>

      <div className="absolute bottom-3 left-3 z-30" ref={floatingAddElPopoverRef}>
        {(() => {
          const canAddElement = Boolean(selected?.sectionPath || selected?.tag === 'section');
          return (
            <>
          <Button
            size="sm"
            className="h-10 gap-2 rounded-md shadow-lg"
            style={{ background: '#995AF2', color: '#fff' }}
            onClick={() => {
              setToolbarPos(null);
              setToolbarAddElOpen(false);
              setFloatingAddElOpen((v) => !v);
            }}
            title={canAddElement ? 'Add elements or sections' : 'Add sections, or select a section to add elements'}
          >
            <Plus className="h-4 w-4" />
            Add element
          </Button>
          {floatingAddElOpen && (
            <div className="absolute bottom-12 left-0 rounded-md border border-border bg-background p-2 shadow-xl">
              {renderAddMenu(floatingAddTab, setFloatingAddTab, () => setFloatingAddElOpen(false), false, canAddElement)}
            </div>
          )}
            </>
          );
        })()}
      </div>

      <div
        className="relative mx-auto h-full w-full transition-all duration-300"
        style={canvasZoom !== 1 ? { transform: `scale(${canvasZoom})`, transformOrigin: 'top center', height: `${100 / canvasZoom}%` } : undefined}
      >
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

  // useMemo avoids the extra re-render cycle that useState+useEffect caused on every html change
  const sectionsList = useMemo<Array<{path: string, title: string}>>(() => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const nodes = Array.from(doc.querySelectorAll('header, section'));
      return nodes.map((el, idx) => ({
        path: (() => {
          let node: HTMLElement | null = el as HTMLElement, parts: string[] = [];
          while (node && node.nodeType === 1 && node !== doc.body) {
            const tag = node.tagName.toLowerCase();
            let i = 1, p: HTMLElement | null = node;
            while ((p = p.previousElementSibling as HTMLElement | null)) if (p.tagName === node.tagName) i++;
            parts.unshift(`${tag}:nth-of-type(${i})`);
            node = node.parentElement as HTMLElement | null;
          }
          return 'body > ' + parts.join(' > ');
        })(),
        title: el.querySelector('h2,h1')?.textContent?.trim() || `Sessão ${idx+1}`,
      }));
    } catch {
      return [];
    }
  }, [html]);

  const adsLayers = useMemo<AdsLayer[]>(() => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const buildPath = (el: Element | null) => {
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

      const roots = Array.from(doc.querySelectorAll('.ad-banner, [data-platform][data-format]'));
      const scope = roots.length > 0 ? roots : Array.from(doc.body.children);
      const ignored = new Set(['script', 'style', 'meta', 'link', 'title', 'base']);
      const layers: AdsLayer[] = [];

      const walk = (el: Element, depth: number) => {
        const tag = el.tagName.toLowerCase();
        if (ignored.has(tag)) return;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const label =
          el.getAttribute('aria-label') ||
          el.getAttribute('alt') ||
          el.getAttribute('data-format') ||
          el.getAttribute('class')?.split(/\s+/).find(Boolean) ||
          text.slice(0, 42) ||
          tag;
        layers.push({
          path: buildPath(el),
          parentPath: buildPath(el.parentElement),
          tag,
          title: label,
          depth,
          zIndex: (el as HTMLElement).style?.zIndex || '',
        });
        Array.from(el.children).forEach((child) => walk(child, depth + 1));
      };

      scope.forEach((el) => walk(el, 0));
      return layers;
    } catch {
      return [];
    }
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
    setImageScale(100);
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

  const selectAdsLayer = (path: string) => {
    const doc = iframeRef.current?.contentDocument;
    const el = doc?.querySelector(path) as HTMLElement | null;
    const frameWindow = doc?.defaultView;
    if (!doc || !el || !frameWindow) return;
    const buildPath = (node: Element | null) => {
      if (!node || node === doc.documentElement) return 'html';
      const parts: string[] = [];
      let current: Element | null = node;
      while (current && current.nodeType === 1 && current !== doc.body) {
        const tag = current.tagName.toLowerCase();
        let idx = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) idx += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${tag}:nth-of-type(${idx})`);
        current = current.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    };

    doc.querySelectorAll('.cf-editor-selected').forEach((node) => node.classList.remove('cf-editor-selected'));
    el.classList.add('cf-editor-selected');

    const computed = frameWindow.getComputedStyle(el);
    const section = el.closest('section');
    const payload: SelectedNode = {
      path,
      sectionPath: section ? buildPath(section) : null,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 500),
      fontFamily: computed.fontFamily || '',
      lineHeight: computed.lineHeight || '',
      whiteSpace: computed.whiteSpace || '',
      overflowWrap: computed.overflowWrap || '',
      wordBreak: computed.wordBreak || '',
      textWrap: computed.textWrap || '',
      src: el.getAttribute('src') || '',
      objectFit: computed.objectFit || 'fill',
      objectPosition: computed.objectPosition || '50% 50%',
      width: computed.width || '',
      minWidth: computed.minWidth || '',
      height: computed.height || '',
      minHeight: computed.minHeight || '',
      maxWidth: computed.maxWidth || '',
      maxHeight: computed.maxHeight || '',
      aspectRatio: computed.aspectRatio || '',
      href: el.getAttribute('href') || '',
      target: el.getAttribute('target') || '',
      rel: el.getAttribute('rel') || '',
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
      isButtonLike: el.tagName === 'BUTTON' || el.tagName === 'A',
    };

    window.postMessage({ source: EDITOR_MESSAGE_SOURCE, type: 'select', payload }, '*');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };

  // Render painel de sessões
  // Drag-and-drop state
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);
  const [draggedLayerPath, setDraggedLayerPath] = useState<string | null>(null);

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

  const moveLayerInStack = (path: string, direction: 'front' | 'back') => {
    applyMutation(path, (el) => {
      const target = el as HTMLElement;
      const current = Number.parseInt(window.getComputedStyle(target).zIndex || target.style.zIndex || '0', 10);
      const next = direction === 'front'
        ? (Number.isFinite(current) ? current + 1 : 1)
        : (Number.isFinite(current) ? current - 1 : -1);
      target.style.position = target.style.position || 'absolute';
      target.style.zIndex = String(next);
    });
  };

  const nudgeSelectedElement = (dx: number, dy: number) => {
    if (!selected?.path) return;
    applyMutation(selected.path, (el, doc) => {
      const target = el as HTMLElement;
      const parent = (target.offsetParent || target.parentElement) as HTMLElement | null;
      const parentRect = parent?.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const computed = window.getComputedStyle(target);
      const left = Number.parseFloat(computed.left);
      const top = Number.parseFloat(computed.top);
      const baseLeft = Number.isFinite(left) && computed.position !== 'static'
        ? left
        : rect.left - (parentRect?.left || 0) + (parent?.scrollLeft || 0);
      const baseTop = Number.isFinite(top) && computed.position !== 'static'
        ? top
        : rect.top - (parentRect?.top || 0) + (parent?.scrollTop || 0);

      if (parent && parent !== doc.body && window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      target.style.position = 'absolute';
      target.style.margin = '0';
      if (!target.style.zIndex || target.style.zIndex === 'auto') target.style.zIndex = '20';
      const rawLeft = baseLeft + dx;
      const rawTop = baseTop + dy;
      const nextLeft = snapToGrid ? Math.round(rawLeft / 8) * 8 : Math.round(rawLeft);
      const nextTop = snapToGrid ? Math.round(rawTop / 8) * 8 : Math.round(rawTop);
      target.style.left = `${nextLeft}px`;
      target.style.top = `${nextTop}px`;
    });
  };

  const applySmartResize = (preset = smartResizePreset) => {
    const [widthRaw, heightRaw] = preset.split('x');
    const nextWidth = Number(widthRaw);
    const nextHeight = Number(heightRaw);
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) {
      toast.error('Invalid resize preset.');
      return;
    }

    applyMutation('body', (body) => {
      const root = (body.querySelector('.ad-banner, [data-platform][data-format]') || body.firstElementChild) as HTMLElement | null;
      if (!root) return;
      const currentWidth = Number.parseFloat(root.style.width || window.getComputedStyle(root).width || String(nextWidth));
      const scale = currentWidth > 0 ? nextWidth / currentWidth : 1;
      root.style.width = `${nextWidth}px`;
      root.style.height = `${nextHeight}px`;
      root.style.position = root.style.position || 'relative';
      root.style.overflow = 'hidden';
      root.setAttribute('data-smart-resized', `${nextWidth}x${nextHeight}`);
      root.querySelectorAll<HTMLElement>('h1,h2,h3,p,span,a,button').forEach((el) => {
        const current = Number.parseFloat(el.style.fontSize || window.getComputedStyle(el).fontSize || '');
        if (Number.isFinite(current) && current > 0) {
          el.style.fontSize = `${Math.max(8, Math.round(current * scale))}px`;
        }
      });
      root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        img.style.maxWidth = img.style.maxWidth || '100%';
        img.style.maxHeight = img.style.maxHeight || '100%';
      });
    });
    toast.success(`Creative resized to ${nextWidth}x${nextHeight}.`);
  };

  const applyAutoLayoutPreset = (preset: 'row' | 'column' | 'center' | 'grid') => {
    const targetPath = selectedWrapperPath || selected?.sectionPath || selected?.path;
    if (!targetPath) {
      toast.info('Select a container or element first.');
      return;
    }

    applyMutation(targetPath, (el) => {
      const target = el as HTMLElement;
      target.style.boxSizing = 'border-box';
      if (preset === 'grid') {
        target.style.display = 'grid';
        target.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        target.style.gap = target.style.gap || '16px';
        target.style.alignItems = 'center';
        return;
      }
      target.style.display = 'flex';
      target.style.flexDirection = preset === 'row' ? 'row' : 'column';
      target.style.flexWrap = 'nowrap';
      target.style.gap = target.style.gap || '12px';
      target.style.alignItems = preset === 'center' ? 'center' : 'stretch';
      target.style.justifyContent = preset === 'center' ? 'center' : 'space-between';
    });
  };

  const applyCropPreset = (preset: 'fill' | 'contain' | 'left' | 'right' | 'top' | 'product') => {
    if (preset === 'fill') {
      setImageFit('cover');
      setImageScale(115);
      applyImageFormattingLive({ nextFit: 'cover', nextScale: 115 });
      return;
    }
    if (preset === 'contain') {
      setImageFit('contain');
      setImageScale(100);
      applyImageFormattingLive({ nextFit: 'contain', nextScale: 100 });
      return;
    }
    if (preset === 'product') {
      setImageFit('contain');
      setImageScale(105);
      setImageMaxWidth('78%');
      applyImageFormattingLive({ nextFit: 'contain', nextScale: 105, nextMaxWidth: '78%' });
      applyShadowLive({ nextBoxEnabled: true, nextBoxY: 12, nextBoxBlur: 32, nextBoxOpacity: 28 });
      return;
    }
    const nextPosition = preset === 'left' ? '18% 50%' : preset === 'right' ? '82% 50%' : '50% 18%';
    const parsed = parsePositionToPercent(nextPosition);
    setImagePosition(nextPosition);
    setImagePositionX(parsed.x);
    setImagePositionY(parsed.y);
    applyImageFormattingLive({ nextPosition });
  };

  const handleLayerDrop = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    if (!draggedLayerPath || draggedLayerPath === targetPath) return;

    const fromLayer = adsLayers.find((layer) => layer.path === draggedLayerPath);
    const toLayer = adsLayers.find((layer) => layer.path === targetPath);
    if (!fromLayer || !toLayer || fromLayer.parentPath !== toLayer.parentPath) {
      toast.info('Layers can be reordered when they share the same parent.');
      setDraggedLayerPath(null);
      return;
    }

    applyMutation(draggedLayerPath, (fromEl, doc) => {
      const toEl = doc.querySelector(targetPath);
      if (!toEl || !fromEl.parentElement || fromEl.parentElement !== toEl.parentElement) return;
      fromEl.parentElement.insertBefore(fromEl, toEl);
    });
    setDraggedLayerPath(null);
  };

  const isEmbeddedFormModal = pendingEmbedMode === 'section' && (pendingSectionType === 'Embedded Form' || pendingSectionType === 'Forms Embedded');
  const embedModalTitle = pendingEmbedMode === 'element'
    ? 'Add Embedded Code Element'
    : isEmbeddedFormModal
      ? 'Add Embedded Form'
      : 'Add Embedded Code to Section';
  const embedModalDescription = pendingEmbedMode === 'element'
    ? 'Paste any HTML, iframe, widget, map, calendar, video, script, or third-party embed. It will be inserted inside the selected section.'
    : isEmbeddedFormModal
      ? 'Paste your form embed code below. HubSpot forms work well here, and other form providers can also be used if they provide an embed snippet.'
      : 'Paste any HTML, iframe, widget, map, calendar, video, script, or third-party embed. It will be inserted inside the new section.';

  const embedModal = showEmbedModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-lg border border-border">
        <h3 className="text-lg font-semibold mb-2">
          {embedModalTitle}
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          {embedModalDescription}
        </p>
        {isEmbeddedFormModal ? (
          <div className="mb-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">HubSpot example</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>In HubSpot, open Marketing &gt; Forms and choose the form.</li>
              <li>Click Share or Embed.</li>
              <li>Copy the embed code, usually a script snippet from HubSpot.</li>
              <li>Paste the full code here and click Add Section.</li>
            </ol>
          </div>
        ) : (
          <div className="mb-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            This accepts common embed formats such as iframes, scripts, widgets, videos, maps, calendars, forms, and custom HTML snippets.
          </div>
        )}
        <textarea
          className="w-full min-h-[100px] rounded border border-border bg-muted/10 p-2 text-sm font-mono mb-4"
          placeholder={isEmbeddedFormModal ? "&lt;script charset=&quot;utf-8&quot; type=&quot;text/javascript&quot; src=&quot;//js.hsforms.net/forms/embed/v2.js&quot;&gt;&lt;/script&gt;..." : "&lt;iframe ...&gt;&lt;/iframe&gt; or any HTML..."}
          value={embedCode}
          onChange={e => setEmbedCode(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={closeEmbedModal}>Cancel</Button>
          <Button
            variant="default"
            onClick={confirmAddEmbed}
            disabled={pendingEmbedMode === 'section' && !pendingSectionType}
          >
            {pendingEmbedMode === 'element' ? 'Add Element' : 'Add Section'}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const sectionsPanel = (
    <div className="mb-4 overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-3 text-left hover:bg-muted/30"
        onClick={() => setSectionsPanelOpen(v => !v)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {sectionsPanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <p className="text-sm font-semibold">Site Sections</p>
            <Badge variant="secondary" className="text-[10px]">{sectionsList.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Add, select, reorder, duplicate, and remove sections.</p>
        </div>
      </button>
      {sectionsPanelOpen && (
        <div className="space-y-4 p-3">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add Section</p>
            <div className="grid grid-cols-2 gap-2">
            {PREDEFINED_SECTIONS.map((s) => (
              <button
                key={s.name}
                type="button"
                className="flex min-h-12 items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/50"
                onClick={() => addPredefinedSection(s.name)}
                title={`Add ${s.label} section`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm">{s.icon}</span>
                <span className="min-w-0 truncate font-medium">{s.label}</span>
              </button>
            ))}
            </div>
                {/* Modal para código embed ao adicionar sessão */}
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Sections</p>
              {sectionsList.length > 0 && <span className="text-[11px] text-muted-foreground">Drag to reorder</span>}
            </div>

            {sectionsList.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-4 text-center">
                <p className="text-sm font-medium">No sections found</p>
                <p className="mt-1 text-xs text-muted-foreground">Start with a hero section, then add the rest of the page structure.</p>
                <Button size="sm" className="mt-3" onClick={() => addPredefinedSection('Hero')}>
                  <Plus className="mr-2 h-4 w-4" /> Add Hero Section
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {sectionsList.map((s, idx) => {
                  const isActive = selected?.sectionPath === s.path;
                  const title = s.title.toLowerCase();
                  const isHeaderNode = /(^|>\s*)header:nth-of-type\(/.test(s.path);
                  const sectionType = isHeaderNode || title.includes('hero')
                    ? 'Hero'
                    : title.includes('embed')
                    ? 'Embedded'
                    : title.includes('form') || title.includes('contact')
                      ? 'Form'
                      : title.includes('proof') || title.includes('trusted') || title.includes('testimonial')
                          ? 'Social Proof'
                          : title.includes('download')
                            ? 'Download'
                            : title.includes('cta') || title.includes('ready')
                              ? 'CTA'
                              : title.includes('benefit') || title.includes('why')
                                ? 'Benefits'
                                : 'Section';

                  return (
                    <li
                      key={s.path}
                      className={`group rounded-md border bg-background transition-colors ${
                        isActive ? 'border-primary/70 bg-primary/5' : 'border-border/60 hover:border-border'
                      } ${draggedSectionIdx === idx ? 'opacity-50' : ''}`}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragEnd={handleDragEnd}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={e => handleDrop(e, idx)}
                    >
                      <div className="flex items-center gap-2 p-2">
                        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => selectSection(s.path)}
                          title="Select section"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                            {idx + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{s.title}</span>
                            <span className="mt-0.5 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {sectionType}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => duplicateSectionByPath(s.path)} title="Duplicate section">
                            <Copy size={15} />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveSection(s.path, 'up')} title="Move up">
                            <ArrowUp size={15} />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveSection(s.path, 'down')} title="Move down">
                            <ArrowDown size={15} />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => { applyMutation(s.path, el => el.remove()); }} title="Remove section">
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const layersPanel = (
    <div className="overflow-hidden rounded-lg border shadow-sm" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(16, 9, 28, 0.92)' }}>
      <div className="border-b px-3 py-3" style={{ borderColor: 'var(--cf-ads-border)' }}>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" style={{ color: 'var(--cf-ads-accent)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--cf-ads-text)' }}>Layers</p>
          <Badge variant="secondary" className="text-[10px]">{adsLayers.length}</Badge>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--cf-ads-muted)' }}>
          Select artwork, reorder the stack, then drag directly on the creative.
        </p>
      </div>

      {adsLayers.length === 0 ? (
        <div className="p-4 text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--cf-ads-text)' }}>No layers found</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--cf-ads-muted)' }}>Open a generated creative to edit its artwork.</p>
        </div>
      ) : (
        <ul className="max-h-[48vh] space-y-1 overflow-auto p-2">
          {adsLayers.map((layer) => {
            const isActive = selected?.path === layer.path;
            return (
              <li
                key={layer.path}
                draggable
                onDragStart={() => setDraggedLayerPath(layer.path)}
                onDragEnd={() => setDraggedLayerPath(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => handleLayerDrop(event, layer.path)}
                className={`group rounded-md border transition-colors ${draggedLayerPath === layer.path ? 'opacity-50' : ''}`}
                style={{
                  borderColor: isActive ? 'var(--cf-ads-primary)' : 'rgba(255,255,255,0.1)',
                  background: isActive ? 'rgba(153, 90, 242, 0.16)' : 'rgba(255,255,255,0.04)',
                }}
              >
                <div className="flex items-center gap-2 p-2" style={{ paddingLeft: `${8 + Math.min(layer.depth, 5) * 12}px` }}>
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => selectAdsLayer(layer.path)}
                    title="Select layer"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase shadow-sm" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--cf-ads-muted)' }}>
                      {layer.tag.slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium" style={{ color: 'var(--cf-ads-text)' }}>{layer.title}</span>
                      <span className="mt-0.5 block truncate text-[10px]" style={{ color: 'var(--cf-ads-muted)' }}>
                        {layer.zIndex ? `z ${layer.zIndex}` : layer.path.replace(/^body\s*>\s*/, '')}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveLayerInStack(layer.path, 'front')} title="Bring forward">
                      <ArrowUp size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveLayerInStack(layer.path, 'back')} title="Send backward">
                      <ArrowDown size={14} />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  function renderAddMenu(
    activeTab: 'element' | 'sections',
    setActiveTab: (tab: 'element' | 'sections') => void,
    closeMenu: () => void,
    compact = false,
    canInsertElement = Boolean(selected?.sectionPath || selected?.tag === 'section'),
  ) {
    return (
      <div className={compact ? 'w-56' : 'w-72'}>
      <div className="mb-2 grid grid-cols-2 rounded-md border border-border/60 bg-muted/30 p-1">
        <button
          type="button"
          className={`rounded px-2 py-1.5 text-xs font-medium ${activeTab === 'element' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('element')}
        >
          Element
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1.5 text-xs font-medium ${activeTab === 'sections' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('sections')}
        >
          Sections
        </button>
      </div>

      {activeTab === 'element' ? (
        <div className="grid grid-cols-2 gap-1.5">
          {!canInsertElement && (
            <p className="col-span-2 rounded border border-border/60 bg-muted/20 px-2 py-2 text-xs text-muted-foreground">
              Select a section or an element inside a section to add elements.
            </p>
          )}
          {Object.entries(ELEMENT_TEMPLATES).map(([type, tmpl]) => (
            <button
              key={type}
              title={`Insert ${tmpl.label}`}
              disabled={!canInsertElement}
              className={`flex items-center gap-2 rounded border border-border/60 bg-muted/40 px-2 py-2 text-left text-xs transition-colors ${
                canInsertElement ? 'hover:bg-muted' : 'cursor-not-allowed opacity-45'
              }`}
              onClick={() => {
                if (!canInsertElement) return;
                insertElement(type);
                closeMenu();
              }}
            >
              <span className={`w-4 text-center leading-none ${type === 'Embedded' ? 'text-[10px] font-semibold' : 'text-base'}`}>{tmpl.icon}</span>
              <span className="min-w-0 truncate">{tmpl.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5">
          {PREDEFINED_SECTIONS.map((section) => (
            <button
              key={section.name}
              title={`Add ${section.label} section`}
              className="flex items-center gap-2 rounded border border-border/60 bg-muted/40 px-2 py-2 text-left text-xs hover:bg-muted transition-colors"
              onClick={() => {
                addPredefinedSection(section.name);
                closeMenu();
              }}
            >
              <span className="flex w-5 justify-center text-muted-foreground">{section.icon}</span>
              <span className="min-w-0 truncate">{section.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    );
  }

  const elementFormattingTabs = (
    <div className="grid grid-cols-3 overflow-hidden rounded-md border text-[11px] shadow-sm" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(255,255,255,0.05)', color: 'var(--cf-ads-muted)' }}>
      {([
        { id: 'content', label: 'Copy', icon: <Pencil className="h-4 w-4" /> },
        { id: 'style', label: 'Visual', icon: <Palette className="h-4 w-4" /> },
        { id: 'advanced', label: 'Layout', icon: <Settings2 className="h-4 w-4" /> },
      ] as const).map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="flex h-14 flex-col items-center justify-center gap-1 border-b-2 transition-colors hover:bg-white/5"
          style={{
            borderColor: editorPanelTab === tab.id ? 'var(--cf-ads-primary)' : 'transparent',
            color: editorPanelTab === tab.id ? 'var(--cf-ads-text)' : 'var(--cf-ads-muted)',
            background: editorPanelTab === tab.id ? 'rgba(153, 90, 242, 0.14)' : 'transparent',
          }}
          onClick={() => {
            setToolbarPos(null);
            setToolbarAddElOpen(false);
            setEditorPanelTab(tab.id);
          }}
        >
          {tab.icon}
          <span className="leading-none">{tab.label}</span>
        </button>
      ))}
    </div>
  );

  const panelContent = (
    <div className="text-sm space-y-3">
      <div className="mb-3 flex items-center gap-2">
        {([
          ['element', 'Design'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
            style={{
              background: editorTab === id ? 'rgba(153, 90, 242, 0.18)' : 'transparent',
              color: editorTab === id ? 'var(--cf-ads-text)' : 'var(--cf-ads-muted)',
              border: editorTab === id ? '1px solid var(--cf-ads-border)' : '1px solid transparent',
            }}
            onClick={() => {
              setToolbarPos(null);
              setToolbarAddElOpen(false);
              setEditorTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-md border" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(255,255,255,0.04)' }}>
        <button
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          onClick={() => {
            setToolbarPos(null);
            setToolbarAddElOpen(false);
            setBrandColorsOpen((v) => !v);
          }}
        >
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4" style={{ color: 'var(--cf-ads-accent)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--cf-ads-text)' }}>Campaign Palette</p>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${brandColorsOpen ? 'rotate-180' : ''}`} />
        </button>
        {brandColorsOpen && (
          <div className="grid grid-cols-1 gap-2 border-t border-border/60 px-3 pb-3 pt-2">
            {([
              ['primary', 'Primary'],
              ['secondary', 'Secondary'],
              ['accent', 'Accent'],
              ['text', 'Text'],
              ['background', 'Background'],
            ] as Array<[keyof typeof globalBrandColors, string]>).map(([key, label]) => {
              const value = globalBrandColors[key] || '#000000';
              const onBlurToast = () => {
                if (brandColorMatchRef.current[key] === false) {
                  toast.message(`${label} updated. No matching color was found on the page.`);
                } else if (brandColorMatchRef.current[key] === true) {
                  toast.success(`${label} updated globally.`);
                }
                delete brandColorMatchRef.current[key];
              };
              return (
                <div key={key} className="grid grid-cols-[88px_40px_minmax(0,1fr)] items-center gap-2">
                  <Label htmlFor={`cf-global-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    id={`cf-global-${key}`}
                    type="color"
                    value={value}
                    className="h-9 w-10 p-1"
                    onChange={(event) => applyGlobalBrandColor(key, label, event.target.value)}
                    onBlur={onBlurToast}
                  />
                  <Input
                    value={value}
                    className="h-9 font-mono text-xs"
                    onChange={(event) => applyGlobalBrandColor(key, label, event.target.value)}
                    onBlur={onBlurToast}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!selected ? (
          <>
            <div className="space-y-2 rounded-md border p-4" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--cf-ads-text)' }}>Select an artwork layer</p>
              <p className="text-xs" style={{ color: 'var(--cf-ads-muted)' }}>Click text, logo, image, button, or choose a layer to edit the creative.</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs" style={{ color: 'var(--cf-ads-muted)' }}>
                <li>Drag directly on the canvas to reposition</li>
                <li>Use Layers to bring items forward or backward</li>
                <li>Use Copy, Visual, and Layout tabs for focused controls</li>
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
          <div className="flex flex-col gap-4">
          {elementFormattingTabs}
          <div className="rounded-md border p-3" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(255,255,255,0.04)' }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--cf-ads-muted)' }}>Position</p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => selected?.path && moveLayerInStack(selected.path, 'front')}>
                  Front
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => selected?.path && moveLayerInStack(selected.path, 'back')}>
                  Back
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <span />
              <Button size="sm" variant="outline" className="h-8" onClick={() => nudgeSelectedElement(0, -8)} title="Move up">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <span />
              <Button size="sm" variant="outline" className="h-8" onClick={() => nudgeSelectedElement(-8, 0)} title="Move left">
                <ArrowDown className="h-4 w-4 rotate-90" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => nudgeSelectedElement(0, 0)} title="Make draggable">
                Pin
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => nudgeSelectedElement(8, 0)} title="Move right">
                <ArrowDown className="h-4 w-4 -rotate-90" />
              </Button>
              <span />
              <Button size="sm" variant="outline" className="h-8" onClick={() => nudgeSelectedElement(0, 8)} title="Move down">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <span />
            </div>
          </div>
          {(selected?.sectionPath || selected?.tag === 'section') && (
            <div className="hidden">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Add element</p>
              <div className="grid grid-cols-4 gap-1.5">
                {Object.entries(ELEMENT_TEMPLATES).map(([type, tmpl]) => (
                  <button
                    key={type}
                    title={`Insert ${tmpl.label}`}
                    className="flex flex-col items-center gap-1 rounded border border-border/60 bg-muted/40 py-2 px-1 text-center hover:bg-muted transition-colors"
                    onClick={() => insertElement(type)}
                  >
                    <span className={`leading-none ${type === 'Embedded' ? 'text-[10px] font-semibold' : 'text-base'}`}>{tmpl.icon}</span>
                    <span className="text-[10px] leading-none text-muted-foreground">{tmpl.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <details open className="order-last rounded-md border" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(255,255,255,0.03)' }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
              Selected Layer
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="p-3 pt-0">
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary" className="font-mono text-xs">{selected.tag}</Badge>
              {selected.sectionPath && <Badge variant="outline" className="text-xs">in section</Badge>}
              {sectionBgMode === 'image' && <Badge variant="outline" className="text-xs">background image mode</Badge>}
            </div>
            {selectedAncestors.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-0.5 text-[11px] text-muted-foreground">
                <button
                  className="hover:text-foreground transition-colors"
                  onClick={() => {
                    try { (iframeRef.current?.contentWindow as any)?.__cfSelectByPath?.('body'); } catch {}
                  }}
                >body</button>
                {selectedAncestors.map((a, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    <span className="opacity-40">›</span>
                    <button
                      className="hover:text-foreground transition-colors font-mono"
                      onClick={() => {
                        try { (iframeRef.current?.contentWindow as any)?.__cfSelectByPath?.(a.path); } catch {}
                      }}
                    >{a.tag}</button>
                  </span>
                ))}
                <span className="opacity-40">›</span>
                <span className="font-mono text-foreground font-medium">{selected.tag}</span>
              </div>
            )}
            </div>
          </details>

          {isTextElementSelected && (
            <details open className={`order-10 rounded-md border border-border/60 ${editorPanelTab === 'content' ? '' : 'hidden'}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Quick Edit
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="space-y-2 p-3 pt-0">
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
            </details>
          )}

          <details className={`order-20 rounded-md border border-border/60 ${editorPanelTab === 'style' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Appearance
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-2 p-3 pt-0">
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
                    setSectionBgMode('solid');
                    applyColorsLive({ nextMode: 'solid', nextBgColor: color });
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
          </details>

          {isHeroSelected() && (selectedBackground || selected.tag === 'img' || ['section', 'header', 'div'].includes(selected.tag)) && !isTextElementSelected && selected.tag !== 'a' && selected.tag !== 'button' && (
            <details open className={`order-20 rounded-md border border-primary/30 bg-primary/5 ${editorPanelTab === 'content' ? '' : 'hidden'}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Hero Section
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="space-y-2 p-3 pt-0">
                <p className="text-xs text-muted-foreground mt-0.5">Quickly replace the main hero image from your uploaded assets.</p>
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
            </details>
          )}

          {(selected.tag === 'img' || selectedBackground) && (
            <div className={`order-10 flex flex-col gap-2 ${editorPanelTab === 'content' ? '' : 'hidden'}`}>
              <details open className={`rounded-md border border-border/60 ${editorPanelTab === 'content' ? '' : 'hidden'}`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Image
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </summary>
                <div className="space-y-2 p-3 pt-0">
                  <p className="text-xs text-muted-foreground mt-0.5">Paste a URL or pick from your uploaded assets.</p>
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
              </details>


              <details open className="order-3 rounded-md border border-border/60">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Image Formatting
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </summary>
                <div className="space-y-2 p-3 pt-0">
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
                <div className="space-y-2 rounded-md border border-primary/25 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Crop & focal point</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('fill')}>Fill</Button>
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('contain')}>Contain</Button>
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('product')}>Product</Button>
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('left')}>Left</Button>
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('top')}>Top</Button>
                    <Button size="sm" variant="outline" onClick={() => applyCropPreset('right')}>Right</Button>
                  </div>
                  <div>
                    <Label htmlFor="cf-image-scale" className="text-xs text-muted-foreground">Zoom ({imageScale}%)</Label>
                    <Input
                      id="cf-image-scale"
                      type="range"
                      min={50}
                      max={220}
                      value={imageScale}
                      onChange={(e) => {
                        const next = Number(e.target.value || 100);
                        setImageScale(next);
                        applyImageFormattingLive({ nextScale: next });
                      }}
                    />
                  </div>
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
              </details>

              <div className="order-2 rounded-md border border-border/60">
                <button
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => setGeminiChatOpen((v) => !v)}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Gemini Image Chat</p>
                    <Badge variant="secondary">AI</Badge>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${geminiChatOpen ? 'rotate-180' : ''}`} />
                </button>

                {geminiChatOpen && (
                  <div className="space-y-3 border-t border-border/60 p-3">
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
                )}
              </div>

              {showAssetManager && (
                <details open className="order-1 rounded-md border border-border/60">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <span>Project Assets Folder</span>
                    <span className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={(event) => { event.preventDefault(); setShowAssetManager(false); }}>Close</Button>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </summary>
                  <div className="space-y-3 p-3 pt-0">

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
                </details>
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

          <details className={`order-10 rounded-md border border-border/60 ${editorPanelTab === 'style' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Typography & Element Formatting
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-2 p-3 pt-0">
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
          </details>

          {/** Shadow controls */}
          <details className={`order-10 rounded-md border border-border/60 ${editorPanelTab === 'style' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Shadows
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-4 p-3 pt-1">
              {/* Box Shadow */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Box Shadow</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={boxShadowEnabled}
                      onChange={(e) => {
                        setBoxShadowEnabled(e.target.checked);
                        applyShadowLive({ nextBoxEnabled: e.target.checked });
                      }}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                </div>
                {boxShadowEnabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">X (px)</Label>
                      <Input type="number" min={-100} max={100} value={boxShadowX}
                        onChange={(e) => { const v = Number(e.target.value); setBoxShadowX(v); applyShadowLive({ nextBoxX: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Y (px)</Label>
                      <Input type="number" min={-100} max={100} value={boxShadowY}
                        onChange={(e) => { const v = Number(e.target.value); setBoxShadowY(v); applyShadowLive({ nextBoxY: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Blur (px)</Label>
                      <Input type="number" min={0} max={100} value={boxShadowBlur}
                        onChange={(e) => { const v = Number(e.target.value); setBoxShadowBlur(v); applyShadowLive({ nextBoxBlur: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Spread (px)</Label>
                      <Input type="number" min={-50} max={50} value={boxShadowSpread}
                        onChange={(e) => { const v = Number(e.target.value); setBoxShadowSpread(v); applyShadowLive({ nextBoxSpread: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Color</Label>
                      <div className="flex gap-1.5">
                        <input type="color" value={boxShadowColor} className="h-10 w-10 cursor-pointer rounded border border-input p-0.5"
                          onChange={(e) => { setBoxShadowColor(e.target.value); applyShadowLive({ nextBoxColor: e.target.value }); }} />
                        <Input value={boxShadowColor}
                          onChange={(e) => { setBoxShadowColor(e.target.value); applyShadowLive({ nextBoxColor: e.target.value }); }} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Opacity ({boxShadowOpacity}%)</Label>
                      <input type="range" min={0} max={100} value={boxShadowOpacity} className="w-full"
                        onChange={(e) => { const v = Number(e.target.value); setBoxShadowOpacity(v); applyShadowLive({ nextBoxOpacity: v }); }} />
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" id="cf-bx-inset" checked={boxShadowInset}
                        onChange={(e) => { setBoxShadowInset(e.target.checked); applyShadowLive({ nextBoxInset: e.target.checked }); }}
                        className="h-3.5 w-3.5 rounded" />
                      <Label htmlFor="cf-bx-inset" className="text-xs text-muted-foreground cursor-pointer">Inset</Label>
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-border/40" />
              {/* Text Shadow */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Text Shadow</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={textShadowEnabled}
                      onChange={(e) => {
                        setTextShadowEnabled(e.target.checked);
                        applyShadowLive({ nextTextEnabled: e.target.checked });
                      }}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                </div>
                {textShadowEnabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">X (px)</Label>
                      <Input type="number" min={-50} max={50} value={textShadowX}
                        onChange={(e) => { const v = Number(e.target.value); setTextShadowX(v); applyShadowLive({ nextTextX: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Y (px)</Label>
                      <Input type="number" min={-50} max={50} value={textShadowY}
                        onChange={(e) => { const v = Number(e.target.value); setTextShadowY(v); applyShadowLive({ nextTextY: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Blur (px)</Label>
                      <Input type="number" min={0} max={50} value={textShadowBlur}
                        onChange={(e) => { const v = Number(e.target.value); setTextShadowBlur(v); applyShadowLive({ nextTextBlur: v }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Opacity ({textShadowOpacity}%)</Label>
                      <input type="range" min={0} max={100} value={textShadowOpacity} className="w-full"
                        onChange={(e) => { const v = Number(e.target.value); setTextShadowOpacity(v); applyShadowLive({ nextTextOpacity: v }); }} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">Color</Label>
                      <div className="flex gap-1.5">
                        <input type="color" value={textShadowColor} className="h-10 w-10 cursor-pointer rounded border border-input p-0.5"
                          onChange={(e) => { setTextShadowColor(e.target.value); applyShadowLive({ nextTextColor: e.target.value }); }} />
                        <Input value={textShadowColor}
                          onChange={(e) => { setTextShadowColor(e.target.value); applyShadowLive({ nextTextColor: e.target.value }); }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </details>

          {/** Hover Effects */}
          <details className={`order-10 rounded-md border border-border/60 ${editorPanelTab === 'style' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Hover Effects
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-3 p-3 pt-1">
              <p className="text-xs text-muted-foreground">Styles applied when the user hovers over this element. Saved in the page HTML.</p>
              {/* Hover text color */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Text color on hover</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={hoverTextColorEnabled}
                      onChange={(e) => { setHoverTextColorEnabled(e.target.checked); applyHoverStyleLive({ nextTextEnabled: e.target.checked }); }}
                      className="h-3.5 w-3.5 rounded" />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                </div>
                {hoverTextColorEnabled && (
                  <div className="flex gap-1.5">
                    <input type="color" value={hoverTextColor} className="h-10 w-10 cursor-pointer rounded border border-input p-0.5"
                      onChange={(e) => { setHoverTextColor(e.target.value); applyHoverStyleLive({ nextTextColor: e.target.value }); }} />
                    <Input value={hoverTextColor}
                      onChange={(e) => { setHoverTextColor(e.target.value); applyHoverStyleLive({ nextTextColor: e.target.value }); }} />
                  </div>
                )}
              </div>
              {/* Hover background color */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Background on hover</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={hoverBgColorEnabled}
                      onChange={(e) => { setHoverBgColorEnabled(e.target.checked); applyHoverStyleLive({ nextBgEnabled: e.target.checked }); }}
                      className="h-3.5 w-3.5 rounded" />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                </div>
                {hoverBgColorEnabled && (
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5">
                      <input type="color" value={hoverBgColor} className="h-10 w-10 cursor-pointer rounded border border-input p-0.5"
                        onChange={(e) => { setHoverBgColor(e.target.value); applyHoverStyleLive({ nextBgColor: e.target.value }); }} />
                      <Input value={hoverBgColor}
                        onChange={(e) => { setHoverBgColor(e.target.value); applyHoverStyleLive({ nextBgColor: e.target.value }); }} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Opacity ({hoverBgOpacity}%)</Label>
                      <input type="range" min={0} max={100} value={hoverBgOpacity} className="w-full"
                        onChange={(e) => { const v = Number(e.target.value); setHoverBgOpacity(v); applyHoverStyleLive({ nextBgOpacity: v }); }} />
                    </div>
                  </div>
                )}
              </div>
              {/* Transition */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Smooth transition</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={hoverTransitionEnabled}
                      onChange={(e) => { setHoverTransitionEnabled(e.target.checked); applyHoverStyleLive({ nextTransitionEnabled: e.target.checked }); }}
                      className="h-3.5 w-3.5 rounded" />
                    <span className="text-xs text-muted-foreground">Enable</span>
                  </label>
                </div>
                {hoverTransitionEnabled && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Duration (ms)</Label>
                    <Input type="number" min={50} max={2000} step={50} value={hoverTransitionDuration}
                      onChange={(e) => { const v = Number(e.target.value); setHoverTransitionDuration(v); applyHoverStyleLive({ nextTransitionDuration: v }); }} />
                  </div>
                )}
              </div>
            </div>
          </details>

          <details open className={`order-9 rounded-md border border-primary/30 bg-primary/5 ${editorPanelTab === 'advanced' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Premium Layout Tools
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-4 p-3 pt-0">
              <div className="space-y-2">
                <Label htmlFor="cf-smart-resize" className="text-xs text-muted-foreground">Smart resize format</Label>
                <div className="flex gap-2">
                  <select
                    id="cf-smart-resize"
                    className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={smartResizePreset}
                    onChange={(e) => setSmartResizePreset(e.target.value)}
                  >
                    <option value="1080x1080">Square 1080x1080</option>
                    <option value="1080x1350">Portrait 1080x1350</option>
                    <option value="1080x1920">Story 1080x1920</option>
                    <option value="1200x628">Feed 1200x628</option>
                    <option value="300x250">Rectangle 300x250</option>
                    <option value="728x90">Leaderboard 728x90</option>
                    <option value="970x90">Billboard 970x90</option>
                    <option value="600x200">Email Header 600x200</option>
                  </select>
                  <Button size="sm" onClick={() => applySmartResize()}>Apply</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Resizes the root ad banner and scales visible typography proportionally.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Auto layout presets</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => applyAutoLayoutPreset('row')}>Flex row</Button>
                  <Button size="sm" variant="outline" onClick={() => applyAutoLayoutPreset('column')}>Flex column</Button>
                  <Button size="sm" variant="outline" onClick={() => applyAutoLayoutPreset('center')}>Center stack</Button>
                  <Button size="sm" variant="outline" onClick={() => applyAutoLayoutPreset('grid')}>2-col grid</Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Guides & snapping</p>
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                    <input type="checkbox" checked={showEditorGrid} onChange={(e) => setShowEditorGrid(e.target.checked)} />
                    Show 8px grid
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                    <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} />
                    Show platform safe zone
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                    <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
                    Snap nudges to 8px grid
                  </label>
                </div>
              </div>
            </div>
          </details>

          {/** Container / Div sizing controls — visible when an element is selected */}
          <details className={`order-10 rounded-md border border-border/60 ${editorPanelTab === 'advanced' ? '' : 'hidden'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Container / Div Sizing
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </summary>
            <div className="space-y-3 p-3 pt-0">

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
                    if (!isCssSize(next)) { setCwError(true); toast.error('Invalid width'); return; }
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
                    if (!isCssSize(next)) { setCmwError(true); toast.error('Invalid min width'); return; }
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
                        if (!isCssSize(next)) { setCpadLError(true); toast.error('Invalid padding'); return; }
                        setCpadLError(false);
                        applyContainerSizingLive({ nextPaddingLeft: next });
                      }}
                      onBlur={() => {
                        if (isCssSize(containerPaddingLeft)) applyContainerSizingLive({ nextPaddingLeft: containerPaddingLeft });
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
                        if (!isCssSize(next)) { setCpadTError(true); toast.error('Invalid padding'); return; }
                        setCpadTError(false);
                        applyContainerSizingLive({ nextPaddingTop: next });
                      }}
                      onBlur={() => {
                        if (isCssSize(containerPaddingTop)) applyContainerSizingLive({ nextPaddingTop: containerPaddingTop });
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
                        if (!isCssSize(next)) { setCpadBError(true); toast.error('Invalid padding'); return; }
                        setCpadBError(false);
                        applyContainerSizingLive({ nextPaddingBottom: next });
                      }}
                      onBlur={() => {
                        if (isCssSize(containerPaddingBottom)) applyContainerSizingLive({ nextPaddingBottom: containerPaddingBottom });
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
                        if (!isCssSize(next)) { setCpadRError(true); toast.error('Invalid padding'); return; }
                        setCpadRError(false);
                        applyContainerSizingLive({ nextPaddingRight: next });
                      }}
                      onBlur={() => {
                        if (isCssSize(containerPaddingRight)) applyContainerSizingLive({ nextPaddingRight: containerPaddingRight });
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
                    if (!isCssSize(next)) { setChError(true); toast.error('Invalid height'); return; }
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
                    if (!isCssSize(next)) { setCmhError(true); toast.error('Invalid min height'); return; }
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
                    if (!isCssSize(next)) { setCmaxwError(true); toast.error('Invalid max width'); return; }
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
                      if (!isCssSize(next)) { setCbwError(true); toast.error('Invalid border width'); return; }
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
                    if (!isCssSize(next)) { setCbrError(true); toast.error('Invalid border radius'); return; }
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
                  if (!isGap(next)) { setCgapError(true); toast.error('Invalid gap. Use values like 8px or 1rem'); return; }
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
                        if (!isGridTemplate(next)) { setCgridColsError(true); toast.error('Invalid grid-template-columns'); return; }
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
                      if (!isGap(next)) { setCgridGapError(true); toast.error('Invalid grid gap'); return; }
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
                      if (!isCssSize(next)) { setCmTError(true); toast.error('Invalid margin top'); return; }
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
                      if (!isCssSize(next)) { setCmBError(true); toast.error('Invalid margin bottom'); return; }
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
                        if (!isCssSize(next)) { setCmLError(true); toast.error('Invalid margin left'); return; }
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
                        if (!isCssSize(next)) { setCmRError(true); toast.error('Invalid margin right'); return; }
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
                    if (!isCssSize(next)) { setCmaxhError(true); toast.error('Invalid max height'); return; }
                    setCmaxhError(false);
                    applyContainerSizingLive({ nextMaxHeight: next });
                  }}
                />
              </div>
            </div>
          </div>
          </details>

          {selected.sectionPath && (
            <details className={`order-30 rounded-md border border-border/60 ${editorPanelTab === 'style' ? '' : 'hidden'}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Section Spacing & Style
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="space-y-2 p-3 pt-0">
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
                      setSectionBgMode('solid');
                      applySectionBackgroundLive({ nextMode: 'solid', nextBgColor: color });
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
            </details>
          )}

          {selected.tag === 'a' && (
            <details open className={`order-0 rounded-md border border-border/60 ${editorPanelTab === 'content' ? '' : 'hidden'}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Link Settings
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="space-y-2 p-3 pt-0">
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
            </details>
          )}

          <Separator className={`order-40 ${editorPanelTab === 'advanced' ? '' : 'hidden'}`} />

          <div className="order-[999] space-y-2">
            {isSelectedSection() ? (
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                style={{ borderColor: 'rgba(153,90,242,0.4)', color: 'var(--cf-ads-text, #F8FAFC)' }}
                onClick={removeSection}
                disabled={!selected?.sectionPath}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove Section
              </Button>
            ) : (
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                style={{ borderColor: 'rgba(153,90,242,0.4)', color: 'var(--cf-ads-text, #F8FAFC)' }}
                onClick={removeElement}
                disabled={!selected?.path}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove Element
              </Button>
            )}
          </div>


          </div>
        )
      }
    </div>
  );


  if (layout === 'overlay') {
    return (
      <>
      <div
        className="relative grid h-full w-full gap-3"
        style={{
          ...adsEditorChromeStyle,
          ...(panelOpen ? { gridTemplateColumns: 'minmax(0,1fr) 380px' } : {}),
          background: 'radial-gradient(circle at 12% 0%, rgba(153, 90, 242, 0.22), transparent 32%), linear-gradient(135deg, #080510, #13091f 55%, #09050f)',
        }}
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-lg" style={{ borderColor: 'var(--cf-ads-border)' }}>
          {iframeEl}
        </div>

        {panelOpen ? (
          <aside
            className="h-full overflow-y-auto rounded-xl border shadow-xl"
            style={{
              borderColor: 'color-mix(in srgb, var(--cf-ads-primary) 32%, transparent)',
              background: 'linear-gradient(180deg, var(--cf-ads-panel), var(--cf-ads-panel-2))',
              color: 'var(--cf-ads-text)',
            }}
            onMouseDownCapture={() => {
              setToolbarPos(null);
              setToolbarAddElOpen(false);
            }}
          >
            <div className="sticky top-0 z-10 border-b px-3 py-3 backdrop-blur" style={{ borderColor: 'var(--cf-ads-border)', background: 'rgba(16, 9, 28, 0.94)' }}>
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setToolbarPos(null);
                    setToolbarAddElOpen(false);
                    setPanelOpen(false);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-muted"
                  title="Hide editor panel"
                >
                  <X className="h-4 w-4" />
                </button>
                <h3 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--cf-ads-text)' }}>Ads Editor</h3>
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
            </div>
            <div className="space-y-3 p-4">{panelContent}</div>
          </aside>
        ) : null}
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
      {embedModal}
      {floatingLayersOpen && layersPanelRect && (
        <div
          ref={floatingLayersPopoverRef}
          style={{
            position: 'fixed',
            top: layersPanelRect.top,
            left: layersPanelRect.left,
            zIndex: 99998,
            width: 320,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {layersPanel}
        </div>
      )}
      </>
    );
  }

  return (
    <>
    <div
      className="grid grid-cols-1 gap-4"
      style={{ ...adsEditorChromeStyle, ...(panelOpen ? { gridTemplateColumns: 'minmax(0, 1fr) 360px' } : {}) }}
    >
      <div className="min-h-[500px] overflow-hidden rounded-xl border border-border bg-white shadow-lg" style={{ minHeight: '70vh', position: 'relative' }}>
        {/* Header with Open Raw Site, Undo/Redo, Save Changes */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-background/95 sticky top-0 z-40">
          {/* Open Raw Site */}
          <Button size="sm" variant="outline" onClick={() => window.open(livePreviewUrl, '_blank')}>Open Raw Site</Button>

          {/* Undo/Redo */}
          <Button size="sm" variant="ghost" className="h-8 px-2 ml-2" onClick={undo} disabled={!canUndo}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={redo} disabled={!canRedo}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Badge variant={saving ? 'default' : 'secondary'} className="ml-2">{saving ? 'Saving...' : 'Saved'}</Badge>

          {/* Save Changes */}
          <Button
            size="sm"
            className="ml-auto text-white font-bold px-5 py-2 rounded shadow transition"
            style={{ background: 'var(--cf-ads-primary, #995AF2)', color: '#fff' }}
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

      {panelOpen && (
        <aside
          className="rounded-xl border border-border bg-background/95 p-4 overflow-y-auto"
          onMouseDownCapture={() => {
            setToolbarPos(null);
            setToolbarAddElOpen(false);
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Ads Editor</h3>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={undo} disabled={!canUndo}>
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={redo} disabled={!canRedo}>
                <Redo2 className="h-4 w-4" />
              </Button>
              <Badge variant={saving ? 'default' : 'secondary'}>{saving ? 'Saving...' : 'Saved'}</Badge>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 ml-1" title="Close editor panel" onClick={() => {
                setToolbarPos(null);
                setToolbarAddElOpen(false);
                setPanelOpen(false);
              }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {panelContent}
          </div>
        </aside>
      )}


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
    {embedModal}
    {floatingLayersOpen && layersPanelRect && (
      <div
        ref={floatingLayersPopoverRef}
        style={{
          position: 'fixed',
          top: layersPanelRect.top,
          left: layersPanelRect.left,
          zIndex: 99998,
          width: 320,
          maxHeight: '70vh',
          overflowY: 'auto',
        }}
      >
        {layersPanel}
      </div>
    )}
    </>
  );
}
