import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { getLocalParticipant } from '../../../base/participants/functions';
import { sendMessage } from '../../actions.web';
import Logger from '@jitsi/logger';
import appConfig from '../../../config/appConfig.json';

const logger = Logger.getLogger(__filename);

const MESSAGE_API_URL = appConfig.api.messageUrl;
const POLLING_INTERVAL = appConfig.message.pollingInterval;

/**
 * 从API获取消息
 * @returns {Promise<string|null>} 消息内容或null
 */
async function fetchMessage(): Promise<string | null> {
    console.group('获取消息');
    console.time('请求耗时');
    console.log('开始请求API:', MESSAGE_API_URL);

    try {
        const response = await fetch(MESSAGE_API_URL);
        const data = await response.json();
        console.timeEnd('请求耗时');

        if (data.code === 200) {
            const message = data.result.message;
            console.log('%c成功获取消息', 'color: #4CAF50; font-weight: bold', message);
            logger.info('成功获取消息:', message);
            console.groupEnd();
            return message;
        } else if (data.code === 404) {
            console.log('%c没有新消息', 'color: #FFA726');
            logger.debug('没有新消息');
        } else if (data.code === 400) {
            console.log('%c消息已被获取', 'color: #F44336', data.result.message);
            logger.warn('消息已被获取:', data.result.message);
        } else {
            console.error('获取消息失败:', data.msg);
            logger.error('获取消息失败:', data.msg);
        }

        console.groupEnd();
        return null;
    } catch (error) {
        console.timeEnd('请求耗时');
        console.error('请求消息接口失败:', error);
        logger.error('请求消息接口失败:', error);
        console.groupEnd();
        return null;
    }
}

/**
 * 自动发送消息的组件
 *
 * @returns {null} 该组件不渲染任何内容
 */
const AutoMessageSender = () => {
    const dispatch = useDispatch();
    const localParticipant = useSelector((state: IReduxState) => getLocalParticipant(state));

    useEffect(() => {
        let pollingTimer: number | undefined;

        const startPolling = () => {
            console.log('%c自动消息发送器已启动', 'color: #2196F3; font-weight: bold', {
                apiUrl: MESSAGE_API_URL,
                pollingInterval: POLLING_INTERVAL,
                role: localParticipant?.role
            });

            const poll = async () => {
                try {
                    const message = await fetchMessage();
                    if (message) {
                        console.group('发送消息');
                        console.log('准备发送消息:', message);
                        dispatch(sendMessage(message));
                        console.log('%c消息已发送', 'color: #4CAF50; font-weight: bold');
                        logger.info('已发送消息:', message);
                        console.groupEnd();
                    }
                } catch (error) {
                    console.error('轮询消息失败:', error);
                    logger.error('轮询消息失败:', error);
                }
                pollingTimer = window.setTimeout(poll, POLLING_INTERVAL);
            };

            poll();
        };

        // 检查是否是主持人
        if (localParticipant?.role !== 'moderator') {
            console.log('%c当前用户不是主持人，自动消息发送器未启动', 'color: #F44336');
            return;
        }

        startPolling();

        // 清理函数
        return () => {
            if (pollingTimer) {
                console.log('%c自动消息发送器已停止', 'color: #F44336');
                clearTimeout(pollingTimer);
            }
        };
    }, [dispatch, localParticipant?.role]);

    // 这个组件不需要渲染任何内容
    return null;
};

export default AutoMessageSender; 