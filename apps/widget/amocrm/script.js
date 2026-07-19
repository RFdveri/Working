/**
 * AmoCRM classic widget bootstrap. This runs inside the AmoCRM interface and
 * mounts an iframe pointing at the deployed AI Door Assistant frontend
 * (apps/widget), passing the current deal/contact so the app can open the
 * matching conversation.
 *
 * NOTE: field/callback names here follow AmoCRM's general widget SDK shape
 * (widget object with render/init/bind_actions/settings). Verify against the
 * current AmoCRM widget SDK docs before submitting to the Marketplace —
 * the API has changed between CRM platform versions.
 */
define(["jquery"], function ($) {
  return function () {
    const self = this;

    self.callbacks = {
      render: function () {
        const settings = self.get_settings();
        const backendBaseUrl = settings.backend_base_url;
        if (!backendBaseUrl) {
          console.warn("AI Door Assistant: backend_base_url is not configured");
          return true;
        }

        const card = self.system().area;
        const entityId =
          card === "lcard"
            ? self.system().lead_id
            : self.system().contact_id;
        const entityType = card === "lcard" ? "deal" : "contact";

        const container = document.createElement("div");
        container.id = "ai-door-assistant-root";
        container.style.width = "100%";
        container.style.height = "640px";

        const iframe = document.createElement("iframe");
        iframe.src = `${backendBaseUrl.replace(/\/$/, "")}/widget/?entityType=${entityType}&entityId=${entityId}`;
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";
        container.appendChild(iframe);

        $(self.system().area_selector || "#" + card).append(container);
        return true;
      },

      init: function () {
        return true;
      },

      bind_actions: function () {
        return true;
      },

      settings: function () {
        return true;
      },

      onSave: function () {
        return true;
      },

      destroy: function () {
        const el = document.getElementById("ai-door-assistant-root");
        if (el) el.remove();
      },
    };

    return this;
  };
});
