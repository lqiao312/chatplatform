import { createApp } from "vue";
import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";

const UsernameDisplay = {
  props: ["actor"],
  computed: {
    username() {
      try {
        const { pathname } = new URL(this.actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : this.actor;
      } catch {
        const m = this.actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : this.actor;
      }
    },
  },
  template: `<span class="username">@{{ username }}</span>`,
};

createApp({
  data() {
    return {
      groups: [],
      groupOperations: {
        loading: false,
        error: null
      },

      newGroupName: "",
      editGroupName: "",
      currentGroup: null,
      selectedGroupObject: null,
      groupNameOverride: null,
      channels: ["designftw"],

      myMessage: "",
      editingMessage: null,
      editedContent: "",

      showProfileEditor: false,
      profile: {
        name: "",
        pronouns: "",
        loaded: false,
        error: null,
      },

      isRecording: false,
      recorder:    null,
      chunks:      [],
      openMenuFor: null,
      transcripts: {},

      volume: 1,
      playbackRate: 1,
      showAudioPopup: false,
      popupAudioUrl: null,
    };
  },

  computed: {
    createSchema() {
      return {
        properties: {
          value: {
            required: ["activity", "object", "published"],
            properties: {
              activity: { const: "Create" },
              object: {
                required: ["type", "name", "channel"],
                properties: {
                  type: { const: "Group Chat" },
                  name: { type: "string" },
                  channel: { type: "string" },
                },
              },
              published: { type: "number" }
            },
          },
        },
      };
    },

    msgSchema() {
      return {
        properties: {
          value: {
            required: ["published"],
            properties: {
              content:   { type: "string" },
              audio:     { type: "string" },
              published: { type: "number" }
            }
          }
        }
      };
    },

    username() {
      const actor = this.$graffitiSession?.value?.actor ?? "";
      try {
        const { pathname } = new URL(actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : actor;
      } catch {
        const m = actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : actor;
      }
    },

    groupName() {
      if (this.groupNameOverride) return this.groupNameOverride.name;
      return this.selectedGroupObject?.value?.object?.name ?? "Unnamed Group";
    },

    sortedGroups() {
      const all = this.$graffiti.state || [];
      return all
        .filter(o =>
          o.channels?.includes("designftw") &&
          o.value.activity === "Create" &&
          o.value.object?.type === "Group Chat"
        )
        .sort((a, b) => b.value.published - a.value.published);
    },
  },

  mounted() {
    if (this.$graffitiSession.value) {
      this.refreshGroups();
    }
  },

  methods: {
    startLogin() {
      const redirect = window.location.origin + window.location.pathname;
      this.$graffiti.login({
        oidcIssuer:  'https://broker.pod.inrupt.com/',
        clientName:  'DesignFTW Chat',
        redirectUrl: redirect
      });
    },

    handleAudioError(message) {
      console.error("Audio playback failed", message);
      message.value.audioError = true;
    },

    async startRecording() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Audio recording not supported in your browser");
        return;
      }
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn("WebM audio not supported, falling back to default codec");
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Got audio stream");
        this.chunks = [];
        this.recorder = new MediaRecorder(stream);
        this.recorder.ondataavailable = e => {
          console.log("Got audio chunk", e.data.size);
          this.chunks.push(e.data);
        };
        this.recorder.start();
        this.isRecording = true;
        console.log("Recording started");
      } catch (err) {
        console.error("Recording failed:", err);
        alert("Couldn't start recording: " + err.message);
      }
    },

    async stopRecording() {
      return new Promise(resolve => {
        this.recorder.onstop = async () => {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          await this.sendAudioMessage(blob);
          this.isRecording = false;
          resolve();
        };
        this.recorder.stop();
      });
    },

    async sendAudioMessage(blob) {
      console.log("Audio blob size:", blob.size); // Check if blob exists
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        console.log("Audio data URL:", dataUrl.substring(0, 100) + "..."); // Check data URL
        const session = this.$graffitiSession.value;
        if (!session) return;
      
        await this.$graffiti.put(
          {
            value: { audio: dataUrl, published: Date.now() },
            channels: this.channels
          },
          session
        );
        console.log("Audio message sent successfully");
      };
      reader.readAsDataURL(blob);
    },

    toggleMenu(msg) {
      this.openMenuFor = this.openMenuFor === msg ? null : msg;
    },

    downloadMessage(msg) {
      if (!msg.value.audio) return;
      const a = document.createElement('a');
      a.href = msg.value.audio;
      const id = msg.url.split('/').pop() || msg.value.published;
      a.download = `audio-${id}.webm`;
      a.click();
      this.openMenuFor = null;
    },

    async transcriptMessage(m) {
       if (!m.value.audio) return;
       try {
        console.log("Transcribing message:", m.url);
        // const res = await fetch('http://localhost:3000/api/transcribe', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ audio: m.value.audio })
        // });
        // const res = await fetch('http://localhost:3000/api/transcribe', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ audio: m.value.audio })
        // });
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: m.value.audio })
        });
        console.log(res.status);
          console.log("Got response:", res.status);
          const body = await res.json();
          console.log("Transcript payload:", body);
          this.transcripts[m.url] = body.transcript;
        } catch (err) {
          console.error('Transcription failed', err);
        alert('Sorry, could not generate transcript.');
      }
    },

    openAudioPopup(src) {
      this.popupAudioUrl = src;
      this.showAudioPopup = true;
      this.$nextTick(() => {
        const aud = this.$refs.popupAudio;
        if (aud) {
          const safeVolume = Math.max(0, Math.min(1, this.volume));
          const safePlaybackRate = Math.max(0.5, Math.min(2, this.playbackRate));
          
          aud.currentTime = 0;
          aud.volume = safeVolume;
          aud.playbackRate = safePlaybackRate;
          aud.play().catch(error => {
            console.error('Audio playback failed:', error);
          });
        }
      });
    },

    closeAudioPopup() {
      const aud = this.$refs.popupAudio;
      if (aud) aud.pause();
      this.showAudioPopup = false;
      this.popupAudioUrl = null;
    },

    changeSpeed() {
      if (this.$refs.popupAudio) {
        const safePlaybackRate = Math.max(0.5, Math.min(2, this.playbackRate));
        this.$refs.popupAudio.playbackRate = safePlaybackRate;
      }
    },

    onLoaded() {
      this.duration = this.$refs.popupAudio.duration;
    },

    handleTransitionEnter(el, done) {
      try {
        done()
      } catch (error) {
        console.error('Enter transition error:', error)
        done()
      }
    },

    handleTransitionLeave(el, done) {
      try {
        done()
      } catch (error) {
        console.error('Leave transition error:', error)
        done()
      }
    },

    formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },

    async createGroupChat(session) {
      try {
        const name = this.newGroupName.trim();
        if (!name) {
          alert("Please enter a group name");
          return;
        }
    
        // Create the group
        const newGroup = {
          value: {
            activity: "Create",
            object: { 
              type: "Group Chat", 
              name, 
              channel: crypto.randomUUID() 
            },
            published: Date.now(),
          },
          channels: ["designftw"],
        };
    
        await this.$graffiti.put(newGroup, session);
    
        this.newGroupName = "";
    
        await this.refreshGroups();
    
        this.enterGroup(newGroup);
    
      } catch (error) {
        console.error("Failed to create group:", error);
        alert("Failed to create group. Please try again.");
      }
    },

    async refreshGroups() {
      try {
        this.groupOperations.loading = true;
        const response = await this.$graffiti.get({
          channels: ["designftw"]
        });
        
        this.groups = response
          .filter(item => item?.value?.activity === "Create")
          .sort((a, b) => b.value.published - a.value.published);
        
      } catch (error) {
        console.error("Group refresh failed:", error);
        this.groupOperations.error = "Failed to load groups";
      } finally {
        this.groupOperations.loading = false;
      }
    },

    enterGroup(group) {
      const groupObj = group.value ? group.value.object : group;
      this.currentGroup = groupObj.channel;
      this.selectedGroupObject = group;
      this.channels = [groupObj.channel];
      this.editGroupName = groupObj.name;
    },

    async setGroupNameOverride(session) {
      try {
        this.groupOperations.loading = true;
        this.groupOperations.error = null;
        
        const name = this.editGroupName.trim();
        if (!name || !this.currentGroup) {
          this.groupOperations.error = "Invalid input";
          return;
        }
    
        // Find group in local cache
        const groupIndex = this.groups.findIndex(
          g => g?.value?.object?.channel === this.currentGroup
        );
    
        if (groupIndex === -1) {
          this.groupOperations.error = "Group not found";
          return;
        }
    
        // Create updated group object
        const updatedGroup = {
          ...this.groups[groupIndex],
          value: {
            ...this.groups[groupIndex].value,
            object: {
              ...this.groups[groupIndex].value.object,
              name: name
            }
          }
        };
    
        // Save using only channel-based approach
        await this.$graffiti.put({
          value: updatedGroup.value,
          channels: [this.currentGroup]
        }, session);
    
        // Update local state
        this.groups[groupIndex] = updatedGroup;
        this.groupNameOverride = { name };
        this.editGroupName = "";
    
      } catch (error) {
        console.error("Group update failed:", error);
        this.groupOperations.error = "Update failed. Please try again.";
      } finally {
        this.groupOperations.loading = false;
      }
    },

    exitGroup() {
      this.currentGroup = null;
      this.channels = ["designftw"];
    },

    async sendMessage() {
      const text = this.myMessage.trim();
      if (!text) return;

      const session = this.$graffitiSession?.value;
      if (!session) return;
  
      await this.$graffiti.put(
        {
          value: { content: text, published: Date.now() },
          channels: this.channels
        },
         session
      );
  
      this.myMessage = "";
    },

    async deleteMessage(message, session) {
      await this.$graffiti.delete(message, session);
    },

    async editMessage(message, newContent, session) {
      const content = newContent.trim();
      if (!content) return;
      await this.$graffiti.patch(
        { value: [{ op: "replace", path: "/content", value: content }] },
        message,
        session
      );
      this.editingMessage = null;
      this.editedContent = "";
    },

    scrollToProfile() {
      const section = document.getElementById("profile-editor");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },

    openProfile() {
        this.showProfileEditor = true;
        this.$nextTick(() => {
        this.scrollToProfile();
      });
    },

    async saveProfile() {
      try {
        this.profile.loading = true;
        this.profile.error = null;
        
        const session = this.$graffitiSession?.value;
        if (!session) throw new Error("Not authenticated");
    
        if (!this.profile.name.trim()) {
          throw new Error("Name is required");
        }
    
        const profileObj = {
          type: "Profile",
          name: this.profile.name.trim(),
          pronouns: this.profile.pronouns.trim(),
          published: new Date().toISOString()
        };
    
        await this.$graffiti.put({
          value: profileObj,
          channels: [session.actor]
        }, session);
    
        this.showProfileEditor = false;
        
      } catch (error) {
        console.error("Profile save error:", error);
        this.profile.error = error.message;
      } finally {
        this.profile.loading = false;
      }
    },
    
    async loadProfile() {
      try {
        this.profile.loading = true;
        this.profile.error = null;
        
        const session = this.$graffitiSession?.value;
        if (!session) return;
    
        // Use discover instead of get to avoid URL validation
        const results = await this.$graffiti.discover({
          channels: [session.actor],
          schema: {
            properties: {
              value: {
                properties: {
                  type: { const: "Profile" }
                }
              }
            }
          }
        });
    
        if (results.length > 0) {
          const latest = results.sort((a, b) => 
            new Date(b.value.published) - new Date(a.value.published)
          )[0];
          
          this.profile.name = latest.value.name || "";
          this.profile.pronouns = latest.value.pronouns || "";
        }
        
      } catch (error) {
        console.error("Profile load error:", error);
        // Silent error - don't show to user during initial load
      } finally {
        this.profile.loading = false;
      }
    },
  },

  watch: {
    "$graffitiSession.value": {
      handler(session) {
        if (session) {
          this.loadProfile();
        } else {
          // Reset profile when logged out
          this.profile = {
            name: "",
            pronouns: "",
            loading: false,
            error: null
          };
        }
      },
      immediate: true
    }
  },
})
.component("username-display", UsernameDisplay)
.use(GraffitiPlugin, { graffiti: new GraffitiRemote({url: "https://chatplatform-base.vercel.app"}) })
.mount("#app");
