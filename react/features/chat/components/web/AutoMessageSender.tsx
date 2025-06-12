import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { getLocalParticipant } from '../../../base/participants/functions';
import { sendMessage } from '../../actions.web';

/**
 * 自动发送消息的组件
 *
 * @returns {null} 该组件不渲染任何内容
 */
const AutoMessageSender = () => {
    const dispatch = useDispatch();
    const localParticipant = useSelector((state: IReduxState) => getLocalParticipant(state));

    useEffect(() => {
        // 检查是否是主持人
        if (localParticipant?.role !== 'moderator') {
            return;
        }

        // 设置定时器，每5秒发送一次消息
        const intervalId = setInterval(() => {
            dispatch(sendMessage('Hello!'));
        }, 5000);

        // 清理定时器
        return () => {
            clearInterval(intervalId);
        };
    }, [ dispatch, localParticipant?.role ]);

    // 这个组件不需要渲染任何内容
    return null;
};

export default AutoMessageSender; 