---
title: "{{title}}"
description: "{{description}}"
author: "{{author}}"
version: "{{version}}"
---

<!-- AUTO-GENERATED: book-formatter (ux core) -->

# {{title}}

{{description}}

{{profileContent}}

## 概要
（本書の概要を記載してください）

## 対象読者
（対象読者を記載してください）

## 前提知識
（前提知識を記載してください）

{{module.readingGuide}}
{{module.quickStart}}

## 目次

{{#if structure.chapters}}
{{#each structure.chapters}}
- [第{{@index}}章 {{title}}](src/chapter-{{id}}/index.md)
{{/each}}
{{/if}}

{{#if structure.appendices}}
## 付録
{{#each structure.appendices}}
- [付録{{@index}} {{title}}](src/appendices/{{id}}.md)
{{/each}}
{{/if}}

{{module.checklistPack}}
{{module.troubleshootingFlow}}
{{module.conceptMap}}
{{module.figureIndex}}
{{module.glossary}}
{{module.legalNotice}}

---

**著者:** {{author}}  
**バージョン:** {{version}}  
**最終更新:** {{currentDate}}
