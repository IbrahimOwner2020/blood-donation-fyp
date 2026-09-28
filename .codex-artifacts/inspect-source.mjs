import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const sourcePath = '/Users/kidibra/Downloads/DOC-20260923-WA0009.pptx';
const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));

console.log('slideSize', presentation.slideSize);
console.log('masters', presentation.masters.items.map((m) => ({ id: m.id, name: m.name })));
console.log('layouts', presentation.layouts.items.map((l) => ({
  id: l.id,
  name: l.name,
  placeholders: l.placeholders.summary(),
})));
console.log((await presentation.inspect({
  kind: 'slide,textbox,shape,image,table,chart,notes,layout',
  maxChars: 50000,
})).ndjson);

for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  console.log('slide-collection', index + 1, {
    shapes: slide.shapes.items.length,
    images: slide.images.items.length,
    tables: slide.tables.items.length,
    charts: slide.charts.items.length,
    shapeMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(slide.shapes)),
    slideMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(slide)),
  });
}
