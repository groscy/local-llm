package com.localllm.intellij

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project

object LocalLlmNotifications {

    private const val GROUP_ID = "com.localllm.intellij.notifications"

    fun notify(project: Project?, title: String, content: String, type: NotificationType) {
        val group = NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID) ?: return
        group.createNotification(title, content, type).notify(project)
    }
}
