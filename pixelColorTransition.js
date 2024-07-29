'use strict'

const outputCanvas = document.getElementById('transition-output');
const outputCanvasContext = outputCanvas.getContext('2d');

const renderButton = document.querySelector('#render-transition');

// TODO: try using workers and OffscreenCanvas()
// offScreen canvas for creating image data (not inserted into document at all)
const offScreenCanvas = document.createElement('canvas');
// WARNING: the bigger the canvas is, the slower the rendering is
// canvas dimensions will be set from the biggest image input dimensions
offScreenCanvas.width = 1;
offScreenCanvas.height = 1;
const offScreenContext = offScreenCanvas.getContext('2d', { willReadFrequently: true });

const imageForm = document.getElementById('image-input-form');

// 60 used by default, also obtained through user input
let hertz = 60;
let frameDurationMs = calculateFrameDurationMs(hertz);
function calculateFrameDurationMs(hertz) {
  return 1000 / hertz;
}

let transitionDurationMs = 1000;

const imageInTheBeginningRegex = /^image/;

// extract image files into the imageFiles array
imageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const imageFiles = [];

  const formData = new FormData(e.currentTarget);
  
  for (const [name, input] of formData) {
    // if it's not an image file (type === image/*) ignore it
    if (imageInTheBeginningRegex.test(input.type)) {
      imageFiles.push(input);
    } else if (name === 'duration') {
      transitionDurationMs = Number(input) * 1000;
    } else if (name === 'hertz') {
      hertz = Number(input);
      frameDurationMs = calculateFrameDurationMs(hertz);
    }
  }

  prepareTransition(imageFiles);
})

async function prepareTransition(imageFiles) {
  renderButton.removeEventListener('click', renderTransition);
  renderButton.classList.remove('display-none');
  renderButton.innerText = 'loading';

  // since order is important, awaits are used;
  // image objects are used to get the dimensions
  const imageObjects = await convertImageFilesIntoImageObjects(imageFiles);
  // imageDatas will be used to manipulate the pixels
  const imageDatas = convertImageObjectsIntoImageDatas(imageObjects);
  transitionImageDatas = await createTransitionImageDatasUsingCanvas(imageDatas);
  
  renderButton.innerText = 'play';
  renderButton.addEventListener('click', renderTransition);
}

async function convertImageFilesIntoImageObjects(imageFilesArr) {
  const imageObjects = [];

  // image objects are created to get the dimensions
  for (const imageFile of imageFilesArr) {
    const fileAsDataURL = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(imageFile);
      reader.addEventListener('load', () => {
        resolve(reader.result);
      });
    });
    const imageObj = new Image();
    imageObj.src = fileAsDataURL;
    // since loading the data into the image obj takes some time, we need to use load events, otherwise width and height are '0'
    await new Promise((resolve) => {
      imageObj.addEventListener('load', resolve);
    });
    imageObjects.push(imageObj);
  }

  return imageObjects;
}

function convertImageObjectsIntoImageDatas(imageObjects) {
  const imageDatas = [];

  // in order to equalize dimensions, get the biggest dimensions, and use it
  let biggestW = 1;
  let biggestH = 1;
  for (const {naturalWidth, naturalHeight} of imageObjects) {
    if (naturalWidth > biggestW) biggestW = naturalWidth;
    if (naturalHeight > biggestH) biggestH = naturalHeight;
  }
  }

  // using just enought dimensions speeds up the rendering process
  offScreenCanvas.width = biggestW;
  offScreenCanvas.height = biggestH;

  for (const imageObject of imageObjects) {
    offScreenContext.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height);
    offScreenContext.drawImage(imageObject, 0, 0);
    const offScreenImageData = offScreenContext.getImageData(0, 0, biggestW, biggestH);
    imageDatas.push(offScreenImageData);
  }

  return imageDatas;
}

// using transparency
async function createTransitionImageDatasUsingCanvas(imageDatasArr) {
  // if length is 1, duplicate that image, allowing a transition
  if (imageDatasArr.length === 1) imageDatasArr.push(imageDatasArr[0]);
  const transitionAmount = imageDatasArr.length - 1;
  // minimum 1, otherwise some will be skipped
  const framesPerTransition = Math.round(transitionDurationMs / frameDurationMs / transitionAmount) || 1;
  // transparencies will change proportionately to this percentage
  const changeInTransparency = 1 / framesPerTransition;

  const transitionImageDatas = {
    initialFrame: imageDatasArr[0],
    allTransitionFrames: []
  }

  // resolutions must be the same, used for creating imageData objects
  const 
    dimensionW = transitionImageDatas.initialFrame.width,
    dimensionH = transitionImageDatas.initialFrame.height
  ;
  
  // in order for the transitions to be smooth, the first frames should not be the original images
  // instead they should be gradually changed versions of them
  // select the first couple, then the second couple..., then the last couple ([0, 1], [1, 2], ..., [last - 1, last])
  const lastImageDataIndex = imageDatasArr.length - 1;
  // create transition frames for each couple
  for (let i = 0; i < lastImageDataIndex; i++) {
    const
      imageDataFrom = imageDatasArr[i],
      imageDataTo = imageDatasArr[i + 1]
    ;

    // TODO: Try not converting imageObjects into imageData, hence there will be no need to convert them into bitmaps
    const 
      bitmapFrom = await createImageBitmap(imageDataFrom, 0, 0, dimensionW, dimensionH),
      bitmapTo = await createImageBitmap(imageDataTo, 0, 0, dimensionW, dimensionH)
    ;

    const transitionFrames = [];

    let changeTimes = 0;
    for (let n = 0; n < framesPerTransition; n++) {
      changeTimes++;
      
      const transparencyImageTo = changeInTransparency * changeTimes;
      const transparencyImageFrom = 1 - transparencyImageTo;
      
      offScreenContext.clearRect(0, 0, offScreenCanvas.width, offScreenCanvas.height);

      // render imageFrom
      offScreenContext.globalAlpha = transparencyImageFrom;
      offScreenContext.drawImage(bitmapFrom, 0, 0);
      // render imageTo
      offScreenContext.globalAlpha = transparencyImageTo;
      offScreenContext.drawImage(bitmapTo, 0, 0);

      const transitionImageData = offScreenContext.getImageData(0, 0, dimensionW, dimensionH);
      transitionFrames.push(transitionImageData);
    }

    bitmapFrom.close();
    bitmapTo.close();

    transitionImageDatas.allTransitionFrames.push(...transitionFrames);
  }
  
  return transitionImageDatas;
}

// transitionImageDatas is global because render transition is used as an event handler
let transitionImageDatas = {};
function renderTransition() {
  const { initialFrame, allTransitionFrames } = transitionImageDatas;

  outputCanvas.width = initialFrame.width;
  outputCanvas.height = initialFrame.height;
  
  outputCanvasContext.putImageData(initialFrame, 0, 0);

  const totalFrames = allTransitionFrames.length;
  let frameIndex = 0; 
  
  requestAnimationFrame(
    requestAnimationFrameInterval
  );

  function requestAnimationFrameInterval() {
    outputCanvasContext.putImageData(allTransitionFrames[frameIndex++], 0, 0);

    if (frameIndex !== totalFrames) {
      requestAnimationFrame(requestAnimationFrameInterval);
    } else {
      console.log('finished');
    }
  }
}


  }
