import { styleUtils } from '../deps/testcafe-core';


function clamp (value, min, max) {
    return Math.min(Math.max(min, value), max);
}

function determineDimensionBounds (bounds, maximum) {
    var hasMin    = typeof bounds.min === 'number';
    var hasMax    = typeof bounds.max === 'number';
    var hasLength = typeof bounds.length === 'number';

    if (hasLength)
        bounds.length = clamp(bounds.length, 0, maximum);

    if (hasMin && bounds.min < 0)
        bounds.min += maximum;

    if (hasMax && bounds.max < 0)
        bounds.max += maximum;

    if (!hasMin)
        bounds.min = hasMax && hasLength ? bounds.max - bounds.length : 0;

    if (!hasMax)
        bounds.max = hasLength ? bounds.min + bounds.length : maximum;

    bounds.min    = clamp(bounds.min, 0, maximum);
    bounds.max    = clamp(bounds.max, 0, maximum);
    bounds.length = bounds.max - bounds.min;

    return bounds;
}

function pixelsToNumber (pixels) {
    return Number(pixels.replace('px', ''));
}

function determineScrollPoint (cropStart, cropEnd, viewportBound) {
    return Math.round(cropStart + (clamp(cropEnd, 0, viewportBound) - cropStart) / 2);
}

export default function ensureCropOptions (element, options) {
    var elementRectangle = element.getBoundingClientRect();

    var elementBounds = {
        left:   elementRectangle.left,
        right:  elementRectangle.right,
        top:    elementRectangle.top,
        bottom: elementRectangle.bottom
    };

    if (options.includeMargins) {
        var computedStyle = styleUtils.getComputedStyle(element);

        var marginLeft = pixelsToNumber(computedStyle.marginLeft);
        var marginTop  = pixelsToNumber(computedStyle.marginTop);
        var marginRight  = pixelsToNumber(computedStyle.marginRight);
        var marginBottom = pixelsToNumber(computedStyle.marginBottom);

        elementBounds.left   -= marginLeft;
        elementBounds.top    -= marginTop;
        elementBounds.right  += marginRight;
        elementBounds.bottom += marginBottom;

        options.marginLeft = marginLeft;
        options.marginRight = marginRight;
        options.marginTop = marginTop;
        options.marginBottom = marginBottom;
    }

    elementBounds.width  = elementBounds.right - elementBounds.left;
    elementBounds.height = elementBounds.bottom - elementBounds.top;

    var horizontalCropBounds = determineDimensionBounds({ min: options.crop.left, max: options.crop.right, length: options.crop.width }, elementBounds.width);
    var verticalCropBounds   = determineDimensionBounds({ min: options.crop.top, max: options.crop.bottom, length: options.crop.height }, elementBounds.height);

    options.crop.left  = horizontalCropBounds.min;
    options.crop.right = horizontalCropBounds.max;
    options.crop.width = horizontalCropBounds.length;

    options.crop.top    = verticalCropBounds.min;
    options.crop.bottom = verticalCropBounds.max;
    options.crop.height = verticalCropBounds.length;

    var viewportDimensions = styleUtils.getViewportDimensions();

    if (elementBounds.width > viewportDimensions.width || elementBounds.height > viewportDimensions.height)
        options.scrollToCenter = true;

    if (typeof options.scrollTargetX !== 'number')
        options.scrollTargetX = determineScrollPoint(options.crop.left, options.crop.right, viewportDimensions.width);

    if (typeof options.scrollTargetY !== 'number')
        options.scrollTargetY = determineScrollPoint(options.crop.top, options.crop.bottom, viewportDimensions.height);
}
