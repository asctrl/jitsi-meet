/* global APP, interfaceConfig */

/* eslint-disable no-unused-vars */
import Logger from '@jitsi/logger';
import $ from 'jquery';
import React from 'react';
import ReactDOM from 'react-dom';

import { browser } from '../../../react/features/base/lib-jitsi-meet';
import { FILMSTRIP_BREAKPOINT } from '../../../react/features/filmstrip/constants';
import { setLargeVideoDimensions } from '../../../react/features/large-video/actions.any';
import { LargeVideoBackground, ORIENTATION } from '../../../react/features/large-video/components/LargeVideoBackground';
import { LAYOUTS } from '../../../react/features/video-layout/constants';
import { getCurrentLayout } from '../../../react/features/video-layout/functions.any';
import appConfig from '../../../react/features/config/appConfig.json';
import UIUtil from '../util/UIUtil';

import Filmstrip from './Filmstrip';
import LargeContainer from './LargeContainer';

// FIXME should be 'video'
export const VIDEO_CONTAINER_TYPE = 'camera';

// Corresponds to animation duration from the animatedFadeIn and animatedFadeOut CSS classes.
const FADE_DURATION_MS = 300;

const logger = Logger.getLogger(__filename);

// 添加截图相关的常量
const SCREENSHOT_INTERVAL = 200; // 200ms = 5次/秒

// 添加 MediaRecorder 辅助函数
const MediaRecorder = window.MediaRecorder;

/**
 * List of container events that we are going to process for the large video.
 *
 * NOTE: Currently used only for logging for debug purposes.
 */
const containerEvents = [ 'abort', 'canplaythrough', 'ended', 'error', 'stalled', 'suspend', 'waiting' ];

/**
 * Returns an array of the video dimensions, so that it keeps it's aspect
 * ratio and fits available area with it's larger dimension. This method
 * ensures that whole video will be visible and can leave empty areas.
 *
 * @param videoWidth the width of the video to position
 * @param videoHeight the height of the video to position
 * @param videoSpaceWidth the width of the available space
 * @param videoSpaceHeight the height of the available space
 * @param subtractFilmstrip whether to subtract the filmstrip or not
 * @return an array with 2 elements, the video width and the video height
 */
function computeDesktopVideoSize( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight,
        subtractFilmstrip) {
    if (videoWidth === 0 || videoHeight === 0 || videoSpaceWidth === 0 || videoSpaceHeight === 0) {
        // Avoid NaN values caused by division by 0.
        return [ 0, 0 ];
    }

    const aspectRatio = videoWidth / videoHeight;
    let availableWidth = Math.max(videoWidth, videoSpaceWidth);
    let availableHeight = Math.max(videoHeight, videoSpaceHeight);

    if (interfaceConfig.VERTICAL_FILMSTRIP) {
        if (subtractFilmstrip) {
            // eslint-disable-next-line no-param-reassign
            videoSpaceWidth -= Filmstrip.getVerticalFilmstripWidth();
        }
    } else {
        // eslint-disable-next-line no-param-reassign
        videoSpaceHeight -= Filmstrip.getFilmstripHeight();
    }

    if (availableWidth / aspectRatio >= videoSpaceHeight) {
        availableHeight = videoSpaceHeight;
        availableWidth = availableHeight * aspectRatio;
    }

    if (availableHeight * aspectRatio >= videoSpaceWidth) {
        availableWidth = videoSpaceWidth;
        availableHeight = availableWidth / aspectRatio;
    }

    return [ availableWidth, availableHeight ];
}


/**
 * Returns an array of the video dimensions. It respects the
 * VIDEO_LAYOUT_FIT config, to fit the video to the screen, by hiding some parts
 * of it, or to fit it to the height or width.
 *
 * @param videoWidth the original video width
 * @param videoHeight the original video height
 * @param videoSpaceWidth the width of the video space
 * @param videoSpaceHeight the height of the video space
 * @return an array with 2 elements, the video width and the video height
 */
function computeCameraVideoSize( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight,
        videoLayoutFit) {
    if (videoWidth === 0 || videoHeight === 0 || videoSpaceWidth === 0 || videoSpaceHeight === 0) {
        // Avoid NaN values caused by division by 0.
        return [ 0, 0 ];
    }

    const aspectRatio = videoWidth / videoHeight;
    const videoSpaceRatio = videoSpaceWidth / videoSpaceHeight;

    switch (videoLayoutFit) {
    case 'height':
        return [ videoSpaceHeight * aspectRatio, videoSpaceHeight ];
    case 'width':
        return [ videoSpaceWidth, videoSpaceWidth / aspectRatio ];
    case 'nocrop':
        return computeCameraVideoSize(
            videoWidth,
            videoHeight,
            videoSpaceWidth,
            videoSpaceHeight,
            videoSpaceRatio < aspectRatio ? 'width' : 'height');
    case 'both': {
        const maxZoomCoefficient = interfaceConfig.MAXIMUM_ZOOMING_COEFFICIENT
            || Infinity;

        if (videoSpaceRatio === aspectRatio) {
            return [ videoSpaceWidth, videoSpaceHeight ];
        }

        let [ width, height ] = computeCameraVideoSize(
            videoWidth,
            videoHeight,
            videoSpaceWidth,
            videoSpaceHeight,
            videoSpaceRatio < aspectRatio ? 'height' : 'width');
        const maxWidth = videoSpaceWidth * maxZoomCoefficient;
        const maxHeight = videoSpaceHeight * maxZoomCoefficient;

        if (width > maxWidth) {
            width = maxWidth;
            height = width / aspectRatio;
        } else if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }

        return [ width, height ];
    }
    default:
        return [ videoWidth, videoHeight ];
    }
}

/**
 * Returns an array of the video horizontal and vertical indents,
 * so that if fits its parent.
 *
 * @return an array with 2 elements, the horizontal indent and the vertical
 * indent
 */
function getCameraVideoPosition( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight) {
    // Parent height isn't completely calculated when we position the video in
    // full screen mode and this is why we use the screen height in this case.
    // Need to think it further at some point and implement it properly.
    if (UIUtil.isFullScreen()) {
        // eslint-disable-next-line no-param-reassign
        videoSpaceHeight = window.innerHeight;
    }

    const horizontalIndent = (videoSpaceWidth - videoWidth) / 2;
    const verticalIndent = (videoSpaceHeight - videoHeight) / 2;

    return { horizontalIndent,
        verticalIndent };
}

/**
 * 获取格式化的时间戳字符串
 * @returns {string} 格式化的时间戳，格式：YYYYMMDD_HHmmss_SSS
 */
function getFormattedTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}${month}${day}_${hours}${minutes}${seconds}_${milliseconds}`;
}

/**
 * 上传图片到服务器
 * @param {Blob} blob - 图片数据
 * @param {string} filename - 文件名
 * @returns {Promise<Object>} 上传结果
 */
async function uploadImage(blob, filename) {
    const formData = new FormData();
    formData.append('files', blob, filename);

    try {
        const response = await fetch(appConfig.api.parseUrl, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        console.group('图片上传结果');
        console.log('上传文件:', filename);
        console.log('服务器响应:', result);
        console.groupEnd();

        return result;
    } catch (error) {
        console.error('上传图片失败:', error);
        logger.error('上传图片失败:', error);
        throw error;
    }
}

/**
 * 发送视频信息到服务器
 * @param {string} userId - 用户ID
 * @param {JitsiTrack} track - 视频轨道
 * @returns {Promise<Object>} 发送结果
 */
async function sendVideoInfo(userId, track) {
    try {
        const response = await fetch(appConfig.api.sendVideoUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: userId,
                trackId: track.getId(),
                trackType: track.getType(),
                isActive: track.isActive(),
                isMuted: track.isMuted(),
                timestamp: new Date().toISOString()
            })
        });

        const result = await response.json();
        console.group('视频信息发送结果');
        console.log('用户ID:', userId);
        console.log('服务器响应:', result);
        console.groupEnd();

        return result;
    } catch (error) {
        console.error('发送视频信息失败:', error);
        logger.error('发送视频信息失败:', error);
        throw error;
    }
}

/**
 * 捕获视频帧并保存为图片
 * @param {HTMLVideoElement} videoElement - 要捕获的视频元素
 * @param {string} userId - 用户ID
 * @param {JitsiTrack} track - 视频轨道
 * @returns {Function} 返回一个用于停止捕获的函数
 */
function captureFrames(videoElement, userId, track) {
    // 检查是否为demo模式
    if (appConfig.demo) {
        console.log('%cDemo模式：跳过截图，发送视频信息', 'color: #2196F3; font-weight: bold');
        logger.info('Demo模式：跳过截图，发送视频信息');
        
        // 发送视频信息
        sendVideoInfo(userId, track).then(result => {
            if (result.code === 200) {
                logger.info('视频信息发送成功:', result.result);
            } else {
                logger.warn('视频信息发送失败:', result.msg);
            }
        }).catch(error => {
            logger.error('发送视频信息时出错:', error);
        });
        
        // 返回空的停止函数
        return () => {};
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let frameCount = 0;
    let lastFrameTime = 0;
    const frameInterval = appConfig.video.screenshot.interval;
    let isCapturing = true;

    /**
     * 检查视频流是否可用
     * @returns {boolean}
     */
    function isStreamActive() {
        return track && !track.isMuted() && track.isActive() && videoElement && videoElement.videoWidth > 0 && videoElement.videoHeight > 0;
    }

    /**
     * 捕获单帧
     * @param {number} timestamp - 当前时间戳
     */
    function captureFrame(timestamp) {
        if (!isCapturing) {
            return;
        }

        if (!isStreamActive()) {
            logger.debug('Video stream is not active, stopping capture');

            isCapturing = false;
            return;
        }

        if (!lastFrameTime) {
            lastFrameTime = timestamp;
        }

        const elapsed = timestamp - lastFrameTime;

        if (elapsed >= frameInterval) {
            try {
                canvas.width = videoElement.videoWidth;
                canvas.height = videoElement.videoHeight;
                context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

                canvas.toBlob(async blob => {
                    if (!blob) {
                        return;
                    }

                    try {
                        const filename = `screenshot_${getFormattedTimestamp()}.jpg`;
                        
                        // 上传图片
                        const uploadResult = await uploadImage(blob, filename);
                        
                        if (uploadResult.code === 200) {
                            logger.info('图片上传成功:', uploadResult.result);
                            
                            // 同时保存到本地
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            a.click();
                            URL.revokeObjectURL(url);
                            
                            frameCount++;
                        } else {
                            logger.warn('图片上传失败:', uploadResult.msg);
                        }
                    } catch (error) {
                        logger.error('处理图片失败:', error);
                    }
                }, appConfig.video.screenshot.format, appConfig.video.screenshot.quality);

                lastFrameTime = timestamp;
            } catch (error) {
                logger.error('捕获帧失败:', error);
            }
        }

        if (isCapturing) {
            requestAnimationFrame(captureFrame);
        }
    }

    // 监听视频轨道状态变化
    if (track) {
        track.on('trackMuteChanged', () => {
            if (track.isMuted()) {
                logger.debug('Video track muted, stopping capture');
                isCapturing = false;
            }
        });

        track.on('trackEnded', () => {
            logger.debug('Video track ended, stopping capture');
            isCapturing = false;
        });
    }

    // 开始帧捕获
    requestAnimationFrame(captureFrame);

    // 返回停止捕获的函数
    return () => {
        isCapturing = false;
    };
}

/**
 * 录制视频流
 * @param {MediaStream} stream - 要录制的媒体流
 * @param {string} userId - 用户ID
 * @param {JitsiTrack} track - 视频轨道
 * @returns {MediaRecorder|null} 返回 MediaRecorder 实例或 null
 */
function recordStream(stream, userId, track) {
    if (!MediaRecorder || !stream || !track || track.isMuted()) {
        logger.error('MediaRecorder not supported or stream/track is invalid/muted');
        return null;
    }

    try {
        const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp8,opus'
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        recorder.onstop = () => {
            try {
                if (chunks.length === 0) {
                    logger.warn('No video data recorded');
                    return;
                }

                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                
                // 创建下载链接
                const a = document.createElement('a');
                a.href = url;
                a.download = `recording_${getFormattedTimestamp()}.webm`;
                a.click();
                
                // 清理
                URL.revokeObjectURL(url);
            } catch (error) {
                logger.error('Error saving recording:', error);
            }
        };

        // 监听视频轨道状态变化
        track.on('trackMuteChanged', () => {
            if (track.isMuted() && recorder.state !== 'inactive') {
                logger.debug('Video track muted, stopping recording');
                recorder.stop();
            }
        });

        track.on('trackEnded', () => {
            if (recorder.state !== 'inactive') {
                logger.debug('Video track ended, stopping recording');
                recorder.stop();
            }
        });

        // 开始录制
        recorder.start();
        return recorder;
    } catch (error) {
        logger.error('Error creating MediaRecorder:', error);
        return null;
    }
}

/**
 * Container for user video.
 */
export class VideoContainer extends LargeContainer {
    /**
     *
     */
    get video() {
        return document.getElementById('largeVideo');
    }

    /**
     *
     */
    get id() {
        return this.userId;
    }

    /**
     * Creates new VideoContainer instance.
     * @param resizeContainer {Function} function that takes care of the size
     * of the video container.
     */
    constructor(resizeContainer) {
        super();
        this.stream = null;
        this.userId = null;
        this.videoType = null;
        this.localFlipX = true;
        this.resizeContainer = resizeContainer;
        this.recorders = new Map();
        this.frameCapturers = new Map();

        /**
         * Whether the background should fit the height of the container
         * (portrait) or fit the width of the container (landscape).
         *
         * @private
         * @type {string|null}
         */
        this._backgroundOrientation = null;

        /**
         * Flag indicates whether or not the background should be rendered.
         * If the background will not be visible then it is hidden to save
         * on performance.
         * @type {boolean}
         */
        this._hideBackground = true;

        this._isHidden = false;

        /**
         * Flag indicates whether or not the avatar is currently displayed.
         * @type {boolean}
         */
        this.avatarDisplayed = false;
        this.avatar = document.getElementById('dominantSpeaker');

        /**
         * The HTMLElements of the remote connection message.
         * @type {HTMLElement}
         */
        this.remoteConnectionMessage = document.getElementById('remoteConnectionMessage');
        this.remotePresenceMessage = document.getElementById('remotePresenceMessage');

        this.$wrapper = $('#largeVideoWrapper');

        this.wrapperParent = document.getElementById('largeVideoElementsContainer');
        this.avatarHeight = document.getElementById('dominantSpeakerAvatarContainer').getBoundingClientRect().height;
        this.video.onplaying = function(event) {
            logger.debug('Large video is playing!');
            if (typeof resizeContainer === 'function') {
                resizeContainer(event);
            }
        };

        containerEvents.forEach(event => {
            this.video.addEventListener(event, () => {
                logger.debug(`${event} handler was called for the large video.`);
            });
        });

        /**
         * A Set of functions to invoke when the video element resizes.
         *
         * @private
         */
        this._resizeListeners = new Set();

        this.video.onresize = this._onResize.bind(this);
        this._play = this._play.bind(this);

        // 添加截图相关的属性
        this._screenshotInterval = null;
        this._screenshotCanvas = document.createElement('canvas');
        this._screenshotContext = this._screenshotCanvas.getContext('2d');
    }

    /**
     * Adds a function to the known subscribers of video element resize
     * events.
     *
     * @param {Function} callback - The subscriber to notify when the video
     * element resizes.
     * @returns {void}
     */
    addResizeListener(callback) {
        this._resizeListeners.add(callback);
    }

    /**
     * Obtains media stream ID of the underlying {@link JitsiTrack}.
     * @return {string|null}
     */
    getStreamID() {
        return this.stream ? this.stream.getId() : null;
    }

    /**
     * Get size of video element.
     * @returns {{width, height}}
     */
    getStreamSize() {
        const video = this.video;


        return {
            width: video.videoWidth,
            height: video.videoHeight
        };
    }

    /**
     * Calculate optimal video size for specified container size.
     * @param {number} containerWidth container width
     * @param {number} containerHeight container height
     * @param {number} verticalFilmstripWidth current width of the vertical filmstrip
     * @returns {{availableWidth, availableHeight}}
     */
    _getVideoSize(containerWidth, containerHeight, verticalFilmstripWidth) {
        const { width, height } = this.getStreamSize();

        if (this.stream && this.isScreenSharing()) {
            return computeDesktopVideoSize(width,
                height,
                containerWidth,
                containerHeight,
                verticalFilmstripWidth < FILMSTRIP_BREAKPOINT);
        }

        return computeCameraVideoSize(width,
            height,
            containerWidth,
            containerHeight,
            interfaceConfig.VIDEO_LAYOUT_FIT);
    }

    /* eslint-disable max-params */
    /**
     * Calculate optimal video position (offset for top left corner)
     * for specified video size and container size.
     * @param {number} width video width
     * @param {number} height video height
     * @param {number} containerWidth container width
     * @param {number} containerHeight container height
     * @param {number} verticalFilmstripWidth current width of the vertical filmstrip
     * @returns {{horizontalIndent, verticalIndent}}
     */
    getVideoPosition(width, height, containerWidth, containerHeight, verticalFilmstripWidth) {
        let containerWidthToUse = containerWidth;

        /* eslint-enable max-params */
        if (this.stream && this.isScreenSharing()) {
            if (interfaceConfig.VERTICAL_FILMSTRIP && verticalFilmstripWidth < FILMSTRIP_BREAKPOINT) {
                containerWidthToUse -= Filmstrip.getVerticalFilmstripWidth();
            }

            return getCameraVideoPosition(width,
                height,
                containerWidthToUse,
                containerHeight);
        }

        return getCameraVideoPosition(width,
                height,
                containerWidthToUse,
                containerHeight);

    }

    /**
     * Updates the positioning of the remote connection presence message and the
     * connection status message which escribes that the remote user is having
     * connectivity issues.
     *
     * @returns {void}
     */
    positionRemoteStatusMessages() {
        this._positionParticipantStatus(this.remoteConnectionMessage);
        this._positionParticipantStatus(this.remotePresenceMessage);
    }

    /**
     * Modifies the position of the passed in jQuery object so it displays
     * in the middle of the video container or below the avatar.
     *
     * @private
     * @returns {void}
     */
    _positionParticipantStatus(element) {
        if (this.avatarDisplayed) {
            const avatarImage = document.getElementById('dominantSpeakerAvatarContainer').getBoundingClientRect();

            element.style.top = avatarImage.top + avatarImage.height + 10;
        } else {
            const height = element.getBoundingClientRect().height;
            const parentHeight = element.parentElement.getBoundingClientRect().height;

            element.style.top = (parentHeight / 2) - (height / 2);
        }
    }

    /**
     *
     */
    resize(containerWidth, containerHeight, animate = false) {
        // XXX Prevent TypeError: undefined is not an object when the Web
        // browser does not support WebRTC (yet).
        if (!this.video) {
            return;
        }
        const state = APP.store.getState();
        const currentLayout = getCurrentLayout(state);

        const verticalFilmstripWidth = state['features/filmstrip'].width?.current;

        if (currentLayout === LAYOUTS.TILE_VIEW || currentLayout === LAYOUTS.STAGE_FILMSTRIP_VIEW) {
            // We don't need to resize the large video since it won't be displayed and we'll resize when returning back
            // to stage view.
            return;
        }

        this.positionRemoteStatusMessages();

        const [ width, height ] = this._getVideoSize(containerWidth, containerHeight, verticalFilmstripWidth);

        if (width === 0 || height === 0) {
            // We don't need to set 0 for width or height since the visibility is controlled by the visibility css prop
            // on the largeVideoElementsContainer. Also if the width/height of the video element is 0 the attached
            // stream won't be played. Normally if we attach a new stream we won't resize the video element until the
            // stream has been played. But setting width/height to 0 will prevent the video from playing.

            return;
        }

        if ((containerWidth > width) || (containerHeight > height)) {
            this._backgroundOrientation = containerWidth > width ? ORIENTATION.LANDSCAPE : ORIENTATION.PORTRAIT;
            this._hideBackground = false;
        } else {
            this._hideBackground = true;
        }

        this._updateBackground();

        const { horizontalIndent, verticalIndent }
            = this.getVideoPosition(width, height, containerWidth, containerHeight, verticalFilmstripWidth);

        APP.store.dispatch(setLargeVideoDimensions(height, width));

        this.$wrapper.animate({
            width,
            height,

            top: verticalIndent,
            bottom: verticalIndent,

            left: horizontalIndent,
            right: horizontalIndent
        }, {
            queue: false,
            duration: animate ? 500 : 0
        });
    }

    /**
     * Removes a function from the known subscribers of video element resize
     * events.
     *
     * @param {Function} callback - The callback to remove from known
     * subscribers of video resize events.
     * @returns {void}
     */
    removeResizeListener(callback) {
        this._resizeListeners.delete(callback);
    }

    /**
     * Plays the large video element.
     *
     * @param {number} retries - Number of retries to play the large video if play fails.
     * @returns {void}
     */
    _play(retries = 0) {
        this.video.play()
            .then(() => {
                logger.debug(`Successfully played large video after ${retries + 1} retries!`);
            })
            .catch(e => {
                if (retries < 3) {
                    logger.debug(`Error while trying to playing the large video. Will retry after 1s. Retries: ${
                        retries}. Error: ${e}`);
                    window.setTimeout(() => {
                        this._play(retries + 1);
                    }, 1000);
                } else {
                    logger.error(`Error while trying to playing the large video after 3 retries: ${e}`);
                }
            });
    }

    /**
     * Update video stream.
     * @param {string} userID
     * @param {JitsiTrack?} stream new stream
     * @param {string} videoType video type
     */
    setStream(userID, stream, videoType) {
        if (this.userId === userID && this.stream === stream && !stream?.forceStreamToReattach) {
            logger.debug(`SetStream on the large video for user ${userID} ignored: the stream is not changed!`);

            if (this.videoType !== videoType) {
                this.videoType = videoType;
                this.resizeContainer();
            }

            return;
        }

        // 停止旧流的录制和帧捕获
        if (this.stream && this.video) {
            try {
                if (this.recorders.has(this.userId)) {
                    const recorder = this.recorders.get(this.userId);
                    if (recorder && recorder.state !== 'inactive') {
                        recorder.stop();
                    }
                    this.recorders.delete(this.userId);
                }
                if (this.frameCapturers.has(this.userId)) {
                    const stopCapture = this.frameCapturers.get(this.userId);
                    if (typeof stopCapture === 'function') {
                        stopCapture();
                    }
                    this.frameCapturers.delete(this.userId);
                }
                this.stream.detach(this.video);
            } catch (error) {
                logger.error('Error cleaning up old stream:', error);
            }
        }

        // 为新流添加日志和录制
        if (stream) {
            try {
                logger.info(`Intercepted video stream for user ${userID}`);
                const mediaStream = stream.getOriginalStream();
                
                // 记录流详情
                logger.info(`Stream details: ${JSON.stringify({
                    id: stream.getId(),
                    type: stream.getType(),
                    videoType,
                    isMuted: stream.isMuted(),
                    isActive: stream.isActive(),
                    tracks: mediaStream.getTracks().map(t => ({
                        kind: t.kind,
                        label: t.label,
                        readyState: t.readyState
                    }))
                })}`);

                // 开始录制
                const recorder = recordStream(mediaStream, userID, stream);
                if (recorder) {
                    this.recorders.set(userID, recorder);
                }

                // 当视频准备好时开始帧捕获或发送视频信息
                if (this.video) {
                    this.video.onloadedmetadata = () => {
                        try {
                            const frameCapturer = captureFrames(this.video, userID, stream);
                            this.frameCapturers.set(userID, frameCapturer);
                        } catch (error) {
                            logger.error('Error starting frame capture:', error);
                        }
                    };
                }
            } catch (error) {
                logger.error('Error setting up new stream:', error);
            }
        }

        this.userId = userID;

        if (stream?.forceStreamToReattach) {
            delete stream.forceStreamToReattach;
        }

        this.stream = stream;
        this.videoType = videoType;

        if (!stream) {
            logger.debug('SetStream on the large video is called without a stream argument!');
            return;
        }

        if (this.video) {
            logger.debug(`Attaching a remote track to the large video for user ${userID}`);
            stream.attach(this.video).catch(error => {
                logger.error(`Attaching the remote track ${stream} to large video has failed with `, error);
            });

            this._play();

            const flipX = stream.isLocal() && this.localFlipX && !this.isScreenSharing();

            this.video.style.transform = flipX ? 'scaleX(-1)' : 'none';
            this._updateBackground();
        } else {
            logger.debug(`SetStream on the large video won't attach a track for ${
                userID} because no large video element was found!`);
        }
    }

    /**
     * Changes the flipX state of the local video.
     * @param val {boolean} true if flipped.
     */
    setLocalFlipX(val) {
        this.localFlipX = val;
        if (!this.video || !this.stream || !this.stream.isLocal() || this.isScreenSharing()) {
            return;
        }
        this.video.style.transform = this.localFlipX ? 'scaleX(-1)' : 'none';

        this._updateBackground();
    }


    /**
     * Check if current video stream is screen sharing.
     * @returns {boolean}
     */
    isScreenSharing() {
        return this.videoType === 'desktop';
    }

    /**
     * Show or hide user avatar.
     * @param {boolean} show
     */
    showAvatar(show) {
        this.avatar.style.visibility = show ? 'visible' : 'hidden';
        this.avatarDisplayed = show;

        APP.API.notifyLargeVideoVisibilityChanged(show);
    }

    /**
     * Show video container.
     */
    show() {
        return new Promise(resolve => {
            this.wrapperParent.style.visibility = 'visible';
            this.wrapperParent.classList.remove('animatedFadeOut');
            this.wrapperParent.classList.add('animatedFadeIn');
            setTimeout(() => {
                this._isHidden = false;
                this._updateBackground();
                resolve();
            }, FADE_DURATION_MS);
        });
    }

    /**
     * Hide video container.
     */
    hide() {
        // as the container is hidden/replaced by another container
        // hide its avatar
        this.showAvatar(false);

        return new Promise(resolve => {
            this.wrapperParent.classList.remove('animatedFadeIn');
            this.wrapperParent.classList.add('animatedFadeOut');
            setTimeout(() => {
                this.wrapperParent.style.visibility = 'hidden';
                this._isHidden = true;
                this._updateBackground();
                resolve();
            }, FADE_DURATION_MS);
        });
    }

    /**
     * @return {boolean} switch on dominant speaker event if on stage.
     */
    stayOnStage() {
        return false;
    }

    /**
     * Callback invoked when the video element changes dimensions.
     *
     * @private
     * @returns {void}
     */
    _onResize() {
        this._resizeListeners.forEach(callback => callback());
    }

    /**
     * Attaches and/or updates a React Component to be used as a background for
     * the large video, to display blurred video and fill up empty space not
     * taken up by the large video.
     *
     * @private
     * @returns {void}
     */
    _updateBackground() {
        // Do not the background display on browsers that might experience
        // performance issues from the presence of the background or if
        // explicitly disabled.
        if (interfaceConfig.DISABLE_VIDEO_BACKGROUND
                || browser.isFirefox()
                || browser.isWebKitBased()) {
            return;
        }

        ReactDOM.render(
            <LargeVideoBackground
                hidden = { this._hideBackground || this._isHidden }
                mirror = {
                    this.stream
                    && this.stream.isLocal()
                    && this.localFlipX
                }
                orientationFit = { this._backgroundOrientation }
                videoElement = { this.video }
                videoTrack = { this.stream } />,
            document.getElementById('largeVideoBackgroundContainer')
        );
    }

    /**
     * 组件销毁时清理资源
     */
    destroy() {
        this._stopScreenshotInterval();
        super.destroy();
    }
}
